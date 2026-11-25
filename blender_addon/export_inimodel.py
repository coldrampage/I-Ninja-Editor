bl_info = {
    "name": "I-Ninja Editor Model and Level Exporter",
    "author": "I-Ninja Editor contributors",
    "version": (1, 1, 0),
    "blender": (3, 6, 0),
    "location": "File > Export > I-Ninja Model / Level Model",
    "description": "Export object models or level render/collision geometry for I-Ninja",
    "category": "Import-Export",
}

import bpy
import json
import math
import struct
import zipfile
from pathlib import Path
from bpy.props import BoolProperty, EnumProperty, FloatProperty, IntProperty, StringProperty
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



# -----------------------------------------------------------------------------
# Native level-model bundle (.inilevel)
# -----------------------------------------------------------------------------
# Retail PC LCM evidence:
#   * render VB: 24-byte vertices = float3 position, BGRA8 diffuse, float2 UV
#   * render indices: uint16 triangle indices (native LCM parts later stitch strips)
#   * LCM collision header: relocated pointer at A+0x20, record count at A+0x24
#   * collision records: float3 position + uint32 flags (16 bytes)
#   * collision triangle closes on bit 0x40; valid record bit 0x80;
#     bit 0x100 reverses the first two vertices; material tag is flags >> 16.
# This exporter writes an interchange bundle. It does not yet write a native LCM.


def _level_byte(value):
    value = max(0.0, min(1.0, float(value)))
    return max(0, min(255, int(round(value * 255.0))))


def _rgba_to_bgra8(rgba):
    if len(rgba) < 4:
        rgba = tuple(rgba[:3]) + (1.0,)
    return (_level_byte(rgba[2]), _level_byte(rgba[1]), _level_byte(rgba[0]), _level_byte(rgba[3]))


def _pack_level_render_vertex(position, rgba, uv):
    """Pack a retail LCM render vertex: XYZ float32, BGRA8, UV float32."""
    bgra = _rgba_to_bgra8(rgba)
    if len(position) != 3 or len(uv) != 2:
        raise ValueError("level render vertices require position3 and uv2")
    values = tuple(float(x) for x in position) + tuple(int(x) for x in bgra) + tuple(float(x) for x in uv)
    if not all(math.isfinite(x) for x in values):
        raise ValueError("level render vertex contains a non-finite component")
    return struct.pack("<3f4B2f", *values)


def _pack_level_collision_triangle(points, material_tag):
    """Pack one independent triangle into the retail 16-byte LCM collision stream."""
    tag = int(material_tag)
    if tag < 0 or tag > 0xFFFF:
        raise ValueError("collision material tag must be in the 0..65535 range")
    if len(points) != 3:
        raise ValueError("collision triangle must have exactly three vertices")
    out = bytearray()
    for index, point in enumerate(points):
        if len(point) != 3:
            raise ValueError("collision record position must contain three coordinates")
        xyz = tuple(float(x) for x in point)
        if not all(math.isfinite(x) and abs(x) < 1.0e7 for x in xyz):
            raise ValueError("collision triangle contains an invalid coordinate")
        # Material occupies the high 16 bits on every record. The final record
        # closes this triangle. The input winding is kept in source loop order.
        flags = (tag << 16) | 0x80 | (0x40 if index == 2 else 0)
        out.extend(struct.pack("<3fI", *xyz, flags))
    return bytes(out)


def _validate_level_collision_stream(data):
    """Validate the triangle-per-three-record interchange representation."""
    if len(data) % 48:
        raise ValueError("collision stream must contain complete 3-record triangles")
    triangle_count = len(data) // 48
    for tri in range(triangle_count):
        base = tri * 48
        tags = []
        for corner in range(3):
            flags = struct.unpack_from("<I", data, base + corner * 16 + 12)[0]
            if not (flags & 0x80):
                raise ValueError("collision triangle %d has a record without valid bit 0x80" % tri)
            if bool(flags & 0x40) != (corner == 2):
                raise ValueError("collision triangle %d has an invalid triangle-end bit pattern" % tri)
            tags.append((flags >> 16) & 0xFFFF)
        if len(set(tags)) != 1:
            raise ValueError("collision triangle %d has inconsistent material tags" % tri)
    return triangle_count


def _level_colour_attribute(mesh, requested_name=""):
    attributes = getattr(mesh, "color_attributes", None)
    if attributes is None:
        return None
    if requested_name:
        attribute = attributes.get(requested_name)
        if attribute is None:
            raise RuntimeError("Mesh '%s' has no colour attribute named '%s'." % (mesh.name, requested_name))
    else:
        attribute = getattr(attributes, "active_color", None) or getattr(attributes, "active", None)
    if attribute is None:
        return None
    if attribute.domain not in {"POINT", "CORNER"}:
        raise RuntimeError("Vertex colour attribute '%s' must use POINT or CORNER domain." % attribute.name)
    if getattr(attribute, "data_type", "") not in {"FLOAT_COLOR", "BYTE_COLOR"}:
        raise RuntimeError("Vertex colour attribute '%s' must be FLOAT_COLOR or BYTE_COLOR." % attribute.name)
    return attribute


def _level_loop_colour(mesh, attribute, loop_index, vertex_index):
    if attribute is None:
        return (1.0, 1.0, 1.0, 1.0)
    index = loop_index if attribute.domain == "CORNER" else vertex_index
    if index < 0 or index >= len(attribute.data):
        raise RuntimeError("Vertex colour attribute '%s' has an invalid data index." % attribute.name)
    colour = attribute.data[index].color
    if len(colour) < 4:
        return tuple(float(x) for x in colour[:3]) + (1.0,)
    return tuple(float(x) for x in colour[:4])


def _level_face_tag_attribute(mesh, attribute_name):
    attributes = getattr(mesh, "attributes", None)
    attribute = attributes.get(attribute_name) if attributes is not None else None
    if attribute is None:
        return None
    if attribute.domain != "FACE" or attribute.data_type != "INT":
        raise RuntimeError("Face tag attribute '%s' must be an INT attribute on the FACE domain." % attribute_name)
    return attribute


def _level_material_collision_tag(material, default_tag):
    if material is None:
        return int(default_tag)
    try:
        value = int(getattr(material, "ininja_collision_tag", -1))
    except Exception:
        value = -1
    if value < 0:
        try:
            value = int(material.get("ininja_collision_tag", -1))
        except Exception:
            value = -1
    return int(default_tag) if value < 0 else value


def _level_face_collision_tag(mesh, obj, polygon, face_attribute, default_tag):
    if face_attribute is not None:
        if polygon.index >= len(face_attribute.data):
            raise RuntimeError("Face collision tag attribute is shorter than the mesh polygon list.")
        tag = int(face_attribute.data[polygon.index].value)
    else:
        material = mesh.materials[polygon.material_index] if polygon.material_index < len(mesh.materials) else None
        if material is None and polygon.material_index < len(obj.material_slots):
            material = obj.material_slots[polygon.material_index].material
        tag = _level_material_collision_tag(material, default_tag)
    if tag < 0 or tag > 0xFFFF:
        raise RuntimeError("Collision face %d on '%s' has tag %d; tags must be 0..65535." % (polygon.index, obj.name, tag))
    return tag


def _level_world_position(evaluated, mesh, vertex_index, scale):
    return _game_vec((evaluated.matrix_world @ mesh.vertices[vertex_index].co) * scale)


def _add_level_render_object(obj, depsgraph, scale, requested_colour_attribute,
                             geometry, mesh_records, materials, material_lookup,
                             texture_files, texture_map, temp_dir):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    if mesh is None:
        return None
    try:
        mesh.calc_loop_triangles()
        uv_layer = mesh.uv_layers.active
        colour_attribute = _level_colour_attribute(mesh, requested_colour_attribute)
        by_material = {}
        for tri in mesh.loop_triangles:
            polygon = mesh.polygons[tri.polygon_index]
            slot_index = int(polygon.material_index)
            material = mesh.materials[slot_index] if slot_index < len(mesh.materials) else None
            if material is None and slot_index < len(obj.material_slots):
                material = obj.material_slots[slot_index].material
            if material is None:
                material = bpy.data.materials.get("I-Ninja Default") or bpy.data.materials.new("I-Ninja Default")
            pointer = material.as_pointer()
            if pointer not in material_lookup:
                material_lookup[pointer] = len(materials)
                materials.append(_material_record(material, len(materials), texture_files, texture_map, temp_dir))
            material_index = material_lookup[pointer]
            group = by_material.setdefault(material_index, {"vertices": [], "indices": [], "lookup": {}})
            for loop_index in tri.loops:
                loop = mesh.loops[loop_index]
                position = _level_world_position(evaluated, mesh, loop.vertex_index, scale)
                colour = _level_loop_colour(mesh, colour_attribute, loop_index, loop.vertex_index)
                bgra = _rgba_to_bgra8(colour)
                uv = tuple(float(x) for x in uv_layer.data[loop_index].uv) if uv_layer else (0.0, 0.0)
                key = tuple(round(float(x), 7) for x in position) + tuple(bgra) + tuple(round(x, 7) for x in uv)
                vertex_index = group["lookup"].get(key)
                if vertex_index is None:
                    vertex_index = len(group["vertices"])
                    if vertex_index >= 65535:
                        raise RuntimeError("Level part '%s' exceeds 65,535 unique vertices; split the mesh by material or object." % obj.name)
                    group["lookup"][key] = vertex_index
                    group["vertices"].append((position, colour, uv))
                group["indices"].append(vertex_index)
        added = []
        for material_index, group in by_material.items():
            if not group["indices"]:
                continue
            while len(geometry) & 3:
                geometry.append(0)
            vertex_offset = len(geometry)
            for position, colour, uv in group["vertices"]:
                geometry.extend(_pack_level_render_vertex(position, colour, uv))
            while len(geometry) & 1:
                geometry.append(0)
            index_offset = len(geometry)
            for index in group["indices"]:
                geometry.extend(struct.pack("<H", index))
            base_colour = materials[material_index].get("baseColor", [1, 1, 1, 1])
            record = {
                "name": obj.name + " / " + materials[material_index]["name"],
                "object": obj.name,
                "material": material_index,
                "vertexOffset": vertex_offset,
                "vertexCount": len(group["vertices"]),
                "indexOffset": index_offset,
                "indexCount": len(group["indices"]),
                "partColourBGRA": list(_rgba_to_bgra8(base_colour)),
            }
            mesh_records.append(record)
            added.append(record)
        return {"name": obj.name, "role": "render", "parts": len(added),
                "colourAttribute": getattr(colour_attribute, "name", None),
                "transformBaked": True}
    finally:
        evaluated.to_mesh_clear()


def _add_level_collision_object(obj, depsgraph, scale, face_tag_attribute_name,
                                default_tag, collision_records, collision_objects,
                                material_counts):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    if mesh is None:
        return None
    try:
        mesh.calc_loop_triangles()
        face_attribute = _level_face_tag_attribute(mesh, face_tag_attribute_name)
        start_record = len(collision_records) // 16
        triangle_count = 0
        for tri in mesh.loop_triangles:
            polygon = mesh.polygons[tri.polygon_index]
            tag = _level_face_collision_tag(mesh, obj, polygon, face_attribute, default_tag)
            points = [_level_world_position(evaluated, mesh, mesh.loops[loop_index].vertex_index, scale)
                      for loop_index in tri.loops]
            collision_records.extend(_pack_level_collision_triangle(points, tag))
            material_counts[tag] = material_counts.get(tag, 0) + 1
            triangle_count += 1
        record_count = (len(collision_records) // 16) - start_record
        result = {"name": obj.name, "role": "collision", "startRecord": start_record,
                  "recordCount": record_count, "triangleCount": triangle_count,
                  "faceTagAttribute": face_attribute.name if face_attribute else None,
                  "transformBaked": True}
        collision_objects.append(result)
        return result
    finally:
        evaluated.to_mesh_clear()


class EXPORT_SCENE_OT_ininja_level(bpy.types.Operator, ExportHelper):
    bl_idname = "export_scene.ininja_level"
    bl_label = "Export I-Ninja Level Model"
    bl_options = {"PRESET"}

    filename_ext = ".inilevel"
    filter_glob: StringProperty(default="*.inilevel", options={"HIDDEN"})
    selected_only: BoolProperty(name="Selected Objects Only", default=True)
    game_unit_scale: FloatProperty(name="Game Unit Scale", default=1.0, min=0.0001, max=10000.0)
    vertex_colour_attribute: StringProperty(name="Vertex Colour Attribute", default="", description="Blank uses each render mesh's active colour attribute; blank meshes export white")
    face_tag_attribute: StringProperty(name="Face Collision Tag Attribute", default="ininja_collision_tag")
    default_collision_tag: IntProperty(name="Default Collision Tag", default=1, min=0, max=65535)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "selected_only")
        layout.prop(self, "game_unit_scale")
        layout.prop(self, "vertex_colour_attribute")
        box = layout.box()
        box.label(text="Separate collision objects use the FACE INT attribute below.")
        box.prop(self, "face_tag_attribute")
        box.prop(self, "default_collision_tag")
        layout.label(text="Render objects export active material textures and BGRA8 vertex colours.")
        layout.label(text="Transforms are baked into level-space vertex positions.")

    def execute(self, context):
        path = Path(self.filepath)
        candidates = [o for o in context.scene.objects if o.type == "MESH" and o.visible_get()]
        selected = [o for o in candidates if o.select_get()]
        if self.selected_only and selected:
            candidates = selected
        elif self.selected_only and not selected:
            self.report({"WARNING"}, "No mesh objects selected; exporting all visible mesh objects.")
        if not candidates:
            self.report({"ERROR"}, "No visible mesh objects to export.")
            return {"CANCELLED"}

        render_objects, collision_mesh_objects = [], []
        for obj in candidates:
            role = str(getattr(obj, "ininja_level_role", obj.get("ininja_level_role", "render"))).lower()
            if role == "collision":
                collision_mesh_objects.append(obj)
            else:
                render_objects.append(obj)
        if not render_objects:
            self.report({"ERROR"}, "At least one object must have the Render role.")
            return {"CANCELLED"}
        if self.default_collision_tag < 0 or self.default_collision_tag > 0xFFFF:
            self.report({"ERROR"}, "Default collision tag must be between 0 and 65535.")
            return {"CANCELLED"}

        import tempfile
        render_geometry = bytearray()
        collision_records = bytearray()
        render_meshes, collision_objects, source_objects = [], [], []
        materials, material_lookup, texture_files, texture_map = [], {}, {}, {}
        material_counts = {}
        depsgraph = context.evaluated_depsgraph_get()
        with tempfile.TemporaryDirectory(prefix="ininja_level_") as temp_dir:
            try:
                for obj in render_objects:
                    source_objects.append(_add_level_render_object(
                        obj, depsgraph, self.game_unit_scale, self.vertex_colour_attribute.strip(),
                        render_geometry, render_meshes, materials, material_lookup,
                        texture_files, texture_map, temp_dir))
                for obj in collision_mesh_objects:
                    source_objects.append(_add_level_collision_object(
                        obj, depsgraph, self.game_unit_scale, self.face_tag_attribute.strip() or "ininja_collision_tag",
                        self.default_collision_tag, collision_records, collision_objects, material_counts))
                if not render_meshes:
                    raise RuntimeError("No render triangles were exported. Check the Render-role objects and their evaluated geometry.")
                collision_triangle_count = _validate_level_collision_stream(collision_records)
                manifest = {
                    "format": "ininja-level-model",
                    "version": 1,
                    "name": path.stem,
                    "coordinateSystem": "i-ninja-y-up",
                    "units": "game-units",
                    "transformPolicy": "object world transforms and gameUnitScale are baked into vertex positions",
                    "render": {
                        "geometryFile": "render.bin",
                        "vertexLayout": "position3-bgra8-uv2-f32",
                        "vertexStride": 24,
                        "colourEncoding": "BGRA8",
                        "colourSource": "Blender active or named POINT/CORNER color attribute; white when absent",
                        "colourValues": "Quantized directly from Blender attribute values; no additional gamma conversion",
                        "indexFormat": "uint16-triangles",
                        "meshes": render_meshes,
                    },
                    "collision": {
                        "present": bool(collision_records),
                        "geometryFile": "collision.bin" if collision_records else None,
                        "recordLayout": "position3-f32-flags-u32",
                        "recordStride": 16,
                        "recordCount": len(collision_records) // 16,
                        "triangleCount": collision_triangle_count,
                        "materialTagBits": "flags[31:16]",
                        "flags": {"valid": "0x0080", "triangleEnd": "0x0040", "reverseFirstTwoVertices": "0x0100"},
                        "winding": "source Blender loop-triangle order; no automatic normal or winding repair",
                        "faceTagAttribute": self.face_tag_attribute.strip() or "ininja_collision_tag",
                        "tagPriority": ["FACE INT mesh attribute", "material ininja_collision_tag property", "defaultCollisionTag"],
                        "defaultCollisionTag": int(self.default_collision_tag),
                        "objects": collision_objects,
                        "materialTagTriangleCounts": {"0x%04X" % k: v for k, v in sorted(material_counts.items())},
                    },
                    "materials": materials,
                    "sourceObjects": source_objects,
                    "nativeOutputStatus": "interchange bundle only; editor native LCM writer is not implemented in this step",
                }
                with zipfile.ZipFile(str(path), "w", compression=zipfile.ZIP_STORED) as archive:
                    archive.writestr("manifest.json", json.dumps(manifest, separators=(",", ":"), ensure_ascii=False))
                    archive.writestr("render.bin", bytes(render_geometry))
                    if collision_records:
                        archive.writestr("collision.bin", bytes(collision_records))
                    for name, data in texture_files.items():
                        archive.writestr(name, data)
            except Exception as exc:
                self.report({"ERROR"}, "Could not export I-Ninja level model: %s" % exc)
                return {"CANCELLED"}

        self.report({"INFO"}, "Exported %d render part(s), %d material(s), %d collision triangle(s), %d texture(s)." %
                    (len(render_meshes), len(materials), collision_triangle_count, len(texture_files)))
        return {"FINISHED"}


class MESH_OT_ininja_set_collision_face_tag(bpy.types.Operator):
    bl_idname = "mesh.ininja_set_collision_face_tag"
    bl_label = "Assign I-Ninja Collision Tag to Selected Faces"
    bl_description = "Write the scene's current 16-bit material tag into the ininja_collision_tag face attribute"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.mode == "EDIT_MESH" and context.edit_object is not None and context.edit_object.type == "MESH"

    def execute(self, context):
        import bmesh
        obj = context.edit_object
        bm = bmesh.from_edit_mesh(obj.data)
        layer_name = "ininja_collision_tag"
        layer = bm.faces.layers.int.get(layer_name)
        default_value = int(context.scene.ininja_level_default_collision_tag)
        if layer is None:
            layer = bm.faces.layers.int.new(layer_name)
            for face in bm.faces:
                face[layer] = default_value
        tag = int(context.scene.ininja_level_face_tag_value)
        if tag < 0 or tag > 0xFFFF:
            self.report({"ERROR"}, "Collision tag must be between 0 and 65535.")
            return {"CANCELLED"}
        count = 0
        for face in bm.faces:
            if face.select:
                face[layer] = tag
                count += 1
        if not count:
            self.report({"WARNING"}, "No faces selected. Select faces in Edit Mode first.")
            return {"CANCELLED"}
        bmesh.update_edit_mesh(obj.data, loop_triangles=True, destructive=False)
        self.report({"INFO"}, "Assigned 0x%04X to %d selected face(s)." % (tag, count))
        return {"FINISHED"}


class VIEW3D_PT_ininja_level_export(bpy.types.Panel):
    bl_label = "I-Ninja Level Export"
    bl_idname = "VIEW3D_PT_ininja_level_export"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "I-Ninja"

    def draw(self, context):
        layout = self.layout
        obj = context.object
        if obj and obj.type == "MESH":
            layout.prop(obj, "ininja_level_role", text="Export role")
            if obj.ininja_level_role == "collision":
                layout.label(text="This object is exported only to collision.bin.", icon="PHYSICS")
                if obj.active_material:
                    layout.prop(obj.active_material, "ininja_collision_tag", text="Material default tag")
            else:
                layout.label(text="This object contributes visible level geometry.", icon="MESH_DATA")
                layout.label(text="Active colour attribute is exported as baked lighting.")
        else:
            layout.label(text="Select a mesh object to set its level-export role.")
        box = layout.box()
        box.label(text="Collision face material tags")
        box.prop(context.scene, "ininja_level_default_collision_tag", text="Default tag")
        box.prop(context.scene, "ininja_level_tag_preset", text="Material preset")
        box.prop(context.scene, "ininja_level_face_tag_value", text="Assign tag (decimal)")
        if context.mode == "EDIT_MESH":
            box.operator("mesh.ininja_set_collision_face_tag", icon="FACESEL")
        else:
            box.label(text="In Edit Mode, select faces then assign the tag.")
        box.label(text="Face INT attribute: ininja_collision_tag")


_LEVEL_MATERIAL_TAG_PRESETS = (
    ("TAG_0000", "0x0000 — No debug text", "No text shown by the supplied debug material viewer"),
    ("TAG_0001", "0x0001 — Can't run on this", "Default non-walkable surface"),
    ("TAG_0002", "0x0002 — Grass", "Grass"),
    ("TAG_0003", "0x0003 — Gravel", "Gravel variant"),
    ("TAG_0004", "0x0004 — Gravel", "Gravel variant"),
    ("TAG_0005", "0x0005 — Wood (Rough)", "Rough wood"),
    ("TAG_0006", "0x0006 — Wood (Polished)", "Polished wood"),
    ("TAG_0007", "0x0007 — Stone", "Stone"),
    ("TAG_0008", "0x0008 — Marble", "Marble"),
    ("TAG_0009", "0x0009 — Carpet", "Carpet"),
    ("TAG_000A", "0x000A — Metal (Solid)", "Solid metal; confirmed standable/wall-running tag in prior tests"),
    ("TAG_000B", "0x000B — Metal (Hollow)", "Hollow metal"),
    ("TAG_000C", "0x000C — Glass", "Glass"),
    ("TAG_000D", "0x000D — Water", "Water"),
    ("TAG_000E", "0x000E — Speed Boost", "Speed boost"),
    ("TAG_000F", "0x000F — Slippy", "Slippery surface"),
    ("TAG_0010", "0x0010 — Sticky", "Sticky surface"),
    ("TAG_0011", "0x0011 — No debug text", "No text shown by the supplied debug material viewer"),
    ("TAG_0101", "0x0101 — Can't run on this", "Extended value; additional 0x0100 component not decoded"),
    ("TAG_0105", "0x0105 — Wood (Rough)", "Extended value; additional 0x0100 component not decoded"),
    ("TAG_010A", "0x010A — Metal (Solid)", "Extended value; additional 0x0100 component not decoded"),
    ("CUSTOM", "Custom numeric value", "Use the numeric tag field below"),
)


def _level_tag_preset_update(scene, context):
    preset = str(scene.ininja_level_tag_preset)
    if preset.startswith("TAG_"):
        scene.ininja_level_face_tag_value = int(preset[4:], 16)


def _register_level_export_properties():
    bpy.types.Object.ininja_level_role = EnumProperty(
        name="I-Ninja Level Export Role",
        items=[("render", "Render Mesh", "Visible level geometry with textures and baked vertex colours"),
               ("collision", "Collision Mesh", "Separate collision geometry with per-face material tags")],
        default="render")
    bpy.types.Material.ininja_collision_tag = IntProperty(
        name="I-Ninja Collision Material Tag", default=-1, min=-1, max=65535,
        description="Fallback tag for collision faces using this material; -1 uses the scene default")
    bpy.types.Scene.ininja_level_default_collision_tag = IntProperty(
        name="Default Collision Material Tag", default=1, min=0, max=65535)
    bpy.types.Scene.ininja_level_face_tag_value = IntProperty(
        name="Face Collision Material Tag", default=1, min=0, max=65535,
        description="Raw unsigned 16-bit collision material tag; decimal input")
    bpy.types.Scene.ininja_level_tag_preset = EnumProperty(
        name="Material Tag Preset", items=_LEVEL_MATERIAL_TAG_PRESETS,
        default="TAG_0001", update=_level_tag_preset_update)


def _unregister_level_export_properties():
    for owner, name in ((bpy.types.Scene, "ininja_level_tag_preset"),
                        (bpy.types.Scene, "ininja_level_face_tag_value"),
                        (bpy.types.Scene, "ininja_level_default_collision_tag"),
                        (bpy.types.Material, "ininja_collision_tag"),
                        (bpy.types.Object, "ininja_level_role")):
        if hasattr(owner, name):
            delattr(owner, name)


def menu_func_export(self, context):
    self.layout.operator(EXPORT_SCENE_OT_ininja_model.bl_idname, text="I-Ninja Model (.inimodel)")
    self.layout.operator(EXPORT_SCENE_OT_ininja_level.bl_idname, text="I-Ninja Level Model (.inilevel)")


classes = (
    EXPORT_SCENE_OT_ininja_model,
    EXPORT_SCENE_OT_ininja_level,
    MESH_OT_ininja_set_collision_face_tag,
    VIEW3D_PT_ininja_level_export,
)


def register():
    _register_level_export_properties()
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_export.append(menu_func_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu_func_export)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    _unregister_level_export_properties()


if __name__ == "__main__":
    register()
