import bpy
import math

# ── Clear the scene ──────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# ── HEAD (UV Sphere, slightly squashed to look more head-like) ──
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=32, ring_count=16,
    radius=1.0,
    location=(0, 0, 0)
)
head = bpy.context.active_object
head.name = "Head"
head.scale = (0.85, 0.9, 1.05)   # narrow sides, taller top
bpy.ops.object.transform_apply(scale=True)

# Smooth shading so it doesn't look blocky
bpy.ops.object.shade_smooth()

# Simple skin-tone material
mat_skin = bpy.data.materials.new(name="Skin")
mat_skin.use_nodes = True
bsdf = mat_skin.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.9, 0.75, 0.6, 1.0)
bsdf.inputs["Roughness"].default_value = 0.6
head.data.materials.append(mat_skin)

# ── HAIR using a particle system ─────────────────────────────
# Select only the top-half of the head as the emitter region
# We add a vertex group for the scalp area
bpy.context.view_layer.objects.active = head
bpy.ops.object.mode_set(mode='EDIT')

import bmesh
bm = bmesh.from_edit_mesh(head.data)
vg = head.vertex_groups.new(name="Scalp")
scalp_verts = []
for v in bm.verts:
    if v.co.z > 0.2:          # only verts above the "ears"
        scalp_verts.append(v.index)

bmesh.update_edit_mesh(head.data)
bpy.ops.object.mode_set(mode='OBJECT')

# Assign the vertex group
head.vertex_groups["Scalp"].add(scalp_verts, 1.0, 'REPLACE')

# Add particle system
bpy.ops.object.particle_system_add()
psys = head.particle_systems[0]
psys.name = "Hair"
psys.vertex_group_density = "Scalp"  # emit only from scalp

settings = psys.settings
settings.type = 'HAIR'
settings.count = 500           # number of hair strands
settings.hair_length = 0.6     # length in Blender units
settings.render_type = 'PATH'
settings.display_step = 5
settings.child_type = 'INTERPOLATED'
settings.child_nbr = 6         # child strands per parent (makes it thicker)
settings.roughness_1 = 0.05   # slight wave/frizz
settings.roughness_endpoint = 0.1

# Hair material (dark brown)
mat_hair = bpy.data.materials.new(name="Hair")
mat_hair.use_nodes = True
bsdf_h = mat_hair.node_tree.nodes["Principled BSDF"]
bsdf_h.inputs["Base Color"].default_value = (0.15, 0.08, 0.04, 1.0)
bsdf_h.inputs["Roughness"].default_value = 0.5
# Use Hair BSDF for a nicer look
mat_hair.node_tree.nodes.remove(bsdf_h)
hair_node = mat_hair.node_tree.nodes.new('ShaderNodeBsdfHairPrincipled')
hair_node.parametrization = 'COLOR'
hair_node.inputs["Color"].default_value = (0.15, 0.08, 0.04, 1.0)
out = mat_hair.node_tree.nodes["Material Output"]
mat_hair.node_tree.links.new(hair_node.outputs[0], out.inputs[0])

head.data.materials.append(mat_hair)
psys.settings.material = 2     # slot 2 = hair material

# ── LIGHTING ──────────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(3, -3, 5))
sun = bpy.context.active_object
sun.data.energy = 3

# ── CAMERA ────────────────────────────────────────────────────
bpy.ops.object.camera_add(location=(0, -3.5, 0.3))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(88), 0, 0)
bpy.context.scene.camera = cam

print("✅ Head with hair created successfully!")