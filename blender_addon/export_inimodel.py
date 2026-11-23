bl_info = {
    "name": "I-Ninja Editor Model Exporter",
    "author": "I-Ninja Editor contributors",
    "version": (1, 0, 2),
    "blender": (3, 6, 0),
    "location": "File > Export > I-Ninja Model (.inimodel)",
    "description": "Export static mesh parts, material textures and collision metadata for I-Ninja Editor",
    "category": "Import-Export",
}

import bpy
import json
import math
import struct
import zipfile
from pathlib import Path
from bpy.props import BoolProperty, EnumProperty, FloatProperty, StringProperty
from bpy_extras.io_utils import ExportHelper


def _game_vec(v):
    # Blender Z-up -> I-Ninja/editor Y-up. The editor's level root supplies the
    # game's handedness mirror, so this mapping itself remains orientation-safe.
    return (float(v.x), float(v.z), float(-v.y))


def _socket_value(node, name, fallback):
    socket = node.inputs.get(name) if node else None
    if socket is None:
        return fallback
    try:
        return tuple(socket.default_value) if hasattr(socket.default_value, "__len__") else float(socket.default_value)
    except Exception:
        return fallback


def _base_colour_and_image(material):
    base = (1.0, 1.0, 1.0, 1.0)
    image = None
    if material and material.use_nodes and material.node_tree:
        principled = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if principled:
            c = _socket_value(principled, "Base Color", base)
            if isinstance(c, tuple) and len(c) >= 4:
                base = tuple(float(x) for x in c[:4])
            alpha = _socket_value(principled, "Alpha", base[3])
            if isinstance(alpha, (float, int)):
                base = (base[0], base[1], base[2], float(alpha))
            socket = principled.inputs.get("Base Color")
            if socket:
                link = next((x for x in material.node_tree.links if x.to_socket == socket and x.from_node.type == "TEX_IMAGE"), None)
                if link:
                    image = link.from_node.image
    return base, image


def _rgba_pixel_data(image):
    """Return Blender image pixels as RGBA floats for an alpha-enabled image.

    Image.pixels is normally exposed as RGBA even when the source file was RGB,
    but account for other channel layouts so generated/loaded images are handled
    consistently across Blender versions.
    """
    width, height = int(image.size[0]), int(image.size[1])
    pixel_count = width * height
    pixels = list(image.pixels[:])
    if pixel_count <= 0 or not pixels or len(pixels) % pixel_count:
        raise RuntimeError("Texture '%s' has no readable pixel data." % image.name)

    stride = len(pixels) // pixel_count
    if stride not in (1, 2, 3, 4):
        raise RuntimeError("Texture '%s' has an unsupported %d-channel pixel buffer." % (image.name, stride))

    channels = int(getattr(image, "channels", stride) or stride)
    rgba = []
    for offset in range(0, len(pixels), stride):
        sample = pixels[offset:offset + stride]
        if stride == 1:
            red = green = blue = sample[0]
            alpha = 1.0
        elif stride == 2:
            red = green = blue = sample[0]
            alpha = sample[1]
        elif stride == 3:
            red, green, blue = sample
            alpha = 1.0
        else:
            red, green, blue, alpha = sample
            # Some Blender image sources expose a four-float pixel buffer while
            # reporting only three stored channels. Do not treat an undefined
            # fourth component as meaningful transparency in that case.
            if channels < 4:
                alpha = 1.0
        rgba.extend((red, green, blue, alpha))
    return rgba


def _save_tga(image, path):
    width, height = int(image.size[0]), int(image.size[1])
    if width < 4 or height < 4 or width > 512 or height > 512 or width & (width - 1) or height & (height - 1):
        raise RuntimeError("Texture '%s' is %dx%d; I-Ninja textures must be power-of-two and 4–512 pixels." % (image.name, width, height))

    # Do not ask Blender's image writer to choose TGA channel depth. That choice
    # can follow the active scene's output settings, which may be RGB (24-bit)
    # even when this Image has an alpha buffer. Write the small uncompressed
    # 32-bit true-colour TGA directly instead. Blender's pixel buffer is
    # bottom-left-origin, matching the game's TGA convention (descriptor 0).
    rgba = _rgba_pixel_data(image)
    expected_values = width * height * 4
    if len(rgba) != expected_values:
        raise RuntimeError("Texture '%s' returned %d RGBA values; expected %d." %
                           (image.name, len(rgba), expected_values))

    # Blender stores image buffers in scene-linear space. Convert common sRGB
    # colour textures back to sRGB byte values; leave Non-Color/data textures
    # untouched. Other named colour spaces are kept as their linear buffer data
    # rather than applying an unknown transform.
    colour_space = str(getattr(getattr(image, "colorspace_settings", None), "name", ""))
    encode_srgb = "srgb" in colour_space.lower()

    def to_byte(value):
        value = max(0.0, min(1.0, float(value)))
        return max(0, min(255, int(round(value * 255.0))))

    def linear_to_srgb(value):
        value = max(0.0, min(1.0, float(value)))
        if value <= 0.0031308:
            return 12.92 * value
        return 1.055 * (value ** (1.0 / 2.4)) - 0.055

    header = bytearray(18)
    header[2] = 2  # uncompressed true-colour TGA
    struct.pack_into("<HH", header, 12, width, height)
    header[16] = 32  # 8 bits each: blue, green, red, alpha
    header[17] = 0   # bottom-left origin, matching the editor/game TGA writer

    output = bytearray(header)
    for offset in range(0, expected_values, 4):
        red, green, blue, alpha = rgba[offset:offset + 4]
        if encode_srgb:
            red, green, blue = linear_to_srgb(red), linear_to_srgb(green), linear_to_srgb(blue)
        output.extend((to_byte(blue), to_byte(green), to_byte(red), to_byte(alpha)))

    data = bytes(output)
    if len(data) != 18 + width * height * 4 or data[2] != 2 or data[16] != 32:
        raise RuntimeError("Could not construct a valid 32-bit TGA for '%s'." % image.name)
    path.write_bytes(data)
    return data


def _material_record(material, index, texture_files, texture_map, temp_dir):
    if material is None:
        material = bpy.data.materials.get("I-Ninja Default") or bpy.data.materials.new("I-Ninja Default")
    key = material.as_pointer()
    if key in texture_map:
        texture = texture_map[key]
    else:
        colour, image = _base_colour_and_image(material)
        texture = None
        if image:
            texture = "textures/texture_%03d.tga" % len(texture_files)
            tga_path = Path(temp_dir) / ("texture_%03d.tga" % len(texture_files))
            texture_files[texture] = _save_tga(image, tga_path)
        texture_map[key] = texture
    colour, _ = _base_colour_and_image(material)
    alpha_mode = str(material.get("ininja_alpha_mode", "OPAQUE")).upper()
    if alpha_mode not in {"OPAQUE", "MASK", "BLEND"}:
        alpha_mode = "OPAQUE"
    blend_mode = str(material.get("ininja_blend_mode", "normal")).lower()
    if blend_mode not in {"normal", "additive", "subtractive"}:
        blend_mode = "normal"
    cutoff = float(material.get("ininja_alpha_cutoff", 0.5))
    return {
        "name": material.name,
        "baseColor": [max(0.0, min(1.0, float(x))) for x in colour],
        "alphaMode": alpha_mode,
        "alphaCutoff": max(0.0, min(1.0, cutoff)),
        "blendMode": blend_mode,
        "doubleSided": not bool(material.use_backface_culling),
        "texture": texture,
    }


def _normal_matrix(matrix):
    return matrix.to_3x3().inverted().transposed()


def _loop_normal(mesh, loop_index):
    try:
        return mesh.corner_normals[loop_index].vector.copy()
    except Exception:
        return mesh.loops[loop_index].normal.copy()


def _add_mesh_object(obj, depsgraph, scale, geometry, mesh_records, materials, material_lookup, texture_files, texture_map, temp_dir):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    if mesh is None:
        return
    try:
        mesh.calc_loop_triangles()
        uv_layer = mesh.uv_layers.active
        normal_matrix = _normal_matrix(evaluated.matrix_world)
        by_material = {}
        for tri in mesh.loop_triangles:
            poly = mesh.polygons[tri.polygon_index]
            slot_index = int(poly.material_index)
            slots = obj.material_slots
            material = slots[slot_index].material if slot_index < len(slots) else None
            if material is None:
                material = bpy.data.materials.get("I-Ninja Default")
                if material is None:
                    material = bpy.data.materials.new("I-Ninja Default")
            if material.as_pointer() not in material_lookup:
                material_lookup[material.as_pointer()] = len(materials)
                materials.append(_material_record(material, len(materials), texture_files, texture_map, temp_dir))
            material_index = material_lookup[material.as_pointer()]
            group = by_material.setdefault(material_index, {"vertices": [], "indices": [], "lookup": {}})
            for loop_index in tri.loops:
                loop = mesh.loops[loop_index]
                vertex = evaluated.matrix_world @ mesh.vertices[loop.vertex_index].co
                vertex = _game_vec(vertex * scale)
                normal = normal_matrix @ _loop_normal(mesh, loop_index)
                normal.normalize()
                normal = _game_vec(normal)
                uv = tuple(uv_layer.data[loop_index].uv) if uv_layer else (0.0, 0.0)
                values = tuple(float(x) for x in (*vertex, *normal, *uv))
                key = tuple(round(x, 7) for x in values)
                vi = group["lookup"].get(key)
                if vi is None:
                    vi = len(group["vertices"])
                    if vi >= 65535:
                        raise RuntimeError("Mesh '%s' has more than 65,535 unique vertices in a material part; split it in Blender." % obj.name)
                    group["lookup"][key] = vi
                    group["vertices"].append(values)
                group["indices"].append(vi)
        for material_index, group in by_material.items():
            if not group["indices"]:
                continue
            while len(geometry) & 3:
                geometry.append(0)
            vertex_offset = len(geometry)
            for values in group["vertices"]:
                geometry.extend(struct.pack("<8f", *values))
            while len(geometry) & 1:
                geometry.append(0)
            index_offset = len(geometry)
            for index in group["indices"]:
                geometry.extend(struct.pack("<H", index))
            mesh_records.append({
                "name": obj.name + " / " + materials[material_index]["name"],
                "material": material_index,
                "vertexOffset": vertex_offset,
                "vertexCount": len(group["vertices"]),
                "indexOffset": index_offset,
                "indexCount": len(group["indices"]),
            })
    finally:
        evaluated.to_mesh_clear()


class EXPORT_SCENE_OT_ininja_model(bpy.types.Operator, ExportHelper):
    bl_idname = "export_scene.ininja_model"
    bl_label = "Export I-Ninja Model"
    bl_options = {"PRESET"}

    filename_ext = ".inimodel"
    filter_glob: StringProperty(default="*.inimodel", options={"HIDDEN"})
    selected_only: BoolProperty(name="Selected Objects Only", default=True)
    game_unit_scale: FloatProperty(name="Game Unit Scale", default=1.0, min=0.0001, max=10000.0)
    collision_type: EnumProperty(
        name="Collision Type",
        items=[("none", "None", "No collision metadata"), ("box", "Box", "Axis-aligned box"), ("sphere", "Sphere", "Bounding sphere"), ("capsule", "Capsule", "Capsule metadata"), ("mesh", "Mesh", "Triangle mesh metadata")],
        default="none",
    )
    collision_x: FloatProperty(name="Collision Size X", default=1.0, min=0.0)
    collision_y: FloatProperty(name="Collision Size Y", default=1.0, min=0.0)
    collision_z: FloatProperty(name="Collision Size Z", default=1.0, min=0.0)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "selected_only")
        layout.prop(self, "game_unit_scale")
        box = layout.box()
        box.label(text="Default collision metadata (not yet written to the game collision format)")
        box.prop(self, "collision_type", text="Type")
        row = box.row(align=True)
        row.prop(self, "collision_x")
        row.prop(self, "collision_y")
        row.prop(self, "collision_z")
        layout.label(text="Material custom properties: ininja_alpha_mode, ininja_blend_mode,")
        layout.label(text="ininja_alpha_cutoff. See blender_addon/README.md.")

    def execute(self, context):
        import tempfile
        path = Path(self.filepath)
        objects = [o for o in context.scene.objects if o.type == "MESH" and o.visible_get()]
        selected = [o for o in objects if o.select_get()]
        if self.selected_only and selected:
            objects = selected
        elif self.selected_only and not selected:
            self.report({"WARNING"}, "No mesh objects selected; exporting all visible mesh objects.")
        if not objects:
            self.report({"ERROR"}, "No visible mesh objects to export.")
            return {"CANCELLED"}
        collision_type = self.collision_type.lower()
        if collision_type not in {"none", "box", "sphere", "capsule", "mesh"}:
            self.report({"ERROR"}, "Collision type must be none, box, sphere, capsule or mesh.")
            return {"CANCELLED"}

        geometry = bytearray()
        mesh_records = []
        materials = []
        material_lookup = {}
        texture_files = {}
        texture_map = {}
        with tempfile.TemporaryDirectory(prefix="ininja_model_") as temp_dir:
            for obj in objects:
                try:
                    _add_mesh_object(obj, context.evaluated_depsgraph_get(), self.game_unit_scale,
                                     geometry, mesh_records, materials, material_lookup,
                                     texture_files, texture_map, temp_dir)
                except Exception as exc:
                    self.report({"ERROR"}, "%s: %s" % (obj.name, exc))
                    return {"CANCELLED"}
            if not mesh_records:
                self.report({"ERROR"}, "No triangulated mesh geometry was exported.")
                return {"CANCELLED"}
            manifest = {
                "format": "ininja-model",
                "version": 1,
                "name": path.stem,
                "coordinateSystem": "i-ninja-y-up",
                "units": "game-units",
                "geometryFile": "geometry.bin",
                "vertexLayout": "position3-normal3-uv2-f32",
                "indexFormat": "uint16-triangles",
                "meshes": mesh_records,
                "materials": materials,
                "collision": {
                    "type": collision_type,
                    "size": [self.collision_x, self.collision_y, self.collision_z],
                },
            }
            try:
                with zipfile.ZipFile(str(path), "w", compression=zipfile.ZIP_STORED) as archive:
                    archive.writestr("manifest.json", json.dumps(manifest, separators=(",", ":"), ensure_ascii=False))
                    archive.writestr("geometry.bin", bytes(geometry))
                    for name, data in texture_files.items():
                        archive.writestr(name, data)
            except Exception as exc:
                self.report({"ERROR"}, "Could not write .inimodel: %s" % exc)
                return {"CANCELLED"}
        self.report({"INFO"}, "Exported %d mesh part(s), %d material(s), %d texture(s)." %
                    (len(mesh_records), len(materials), len(texture_files)))
        return {"FINISHED"}


def menu_func_export(self, context):
    self.layout.operator(EXPORT_SCENE_OT_ininja_model.bl_idname, text="I-Ninja Model (.inimodel)")


classes = (EXPORT_SCENE_OT_ininja_model,)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_export.append(menu_func_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu_func_export)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
