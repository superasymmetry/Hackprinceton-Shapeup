import bpy
import math
import bmesh
import random # Imported to break up the perfect circles

# ── Clear the scene ───────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# ── HEAD ──────────────────────────────────────────────────────
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=32, ring_count=16,
    radius=1.0,
    location=(0, 0, 0)
)
head = bpy.context.active_object
head.name = "Head"
head.scale = (0.85, 0.9, 1.05)
bpy.ops.object.transform_apply(scale=True)
bpy.ops.object.shade_smooth()

# Skin material
mat_skin = bpy.data.materials.new(name="Skin")
mat_skin.use_nodes = True
bsdf = mat_skin.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.9, 0.75, 0.6, 1.0)
bsdf.inputs["Roughness"].default_value = 0.6
head.data.materials.append(mat_skin)

# ── VERTEX GROUPS ─────────────────────────────────────────────
bpy.context.view_layer.objects.active = head
bpy.ops.object.mode_set(mode='EDIT')

bm = bmesh.from_edit_mesh(head.data)

vg_crown = head.vertex_groups.new(name="CrownCurls") 
vg_mid   = head.vertex_groups.new(name="MidCurls")   
vg_sides = head.vertex_groups.new(name="ShortSides") 

crown_verts = []
mid_verts   = []
sides_verts = []

for v in bm.verts:
    x, y, z = v.co.x, v.co.y, v.co.z
    
    if y < -0.15 and z < 0.35:
        continue  
        
    # Introduce slight randomness so the zones aren't perfectly circular bands
    z_noisy = z + random.uniform(-0.1, 0.1)
        
    if z_noisy > 0.55:
        crown_verts.append(v.index)
    elif z_noisy > 0.15: 
        mid_verts.append(v.index)
    elif z_noisy > -0.3: 
        sides_verts.append(v.index)

bmesh.update_edit_mesh(head.data)
bpy.ops.object.mode_set(mode='OBJECT')

vg_crown.add(crown_verts, 1.0, 'REPLACE')
vg_mid.add(mid_verts, 1.0, 'REPLACE')
vg_sides.add(sides_verts, 1.0, 'REPLACE')

# ── HAIR MATERIAL ─────────────────────────────────────────────
mat_hair = bpy.data.materials.new(name="Hair")
mat_hair.use_nodes = True
nodes = mat_hair.node_tree.nodes
links = mat_hair.node_tree.links

for n in list(nodes):
    nodes.remove(n)

hair_bsdf = nodes.new('ShaderNodeBsdfHairPrincipled')
hair_bsdf.parametrization = 'COLOR'
hair_bsdf.inputs["Color"].default_value        = (0.08, 0.04, 0.02, 1.0)
hair_bsdf.inputs["Roughness"].default_value    = 0.45
hair_bsdf.inputs["Radial Roughness"].default_value = 0.3

out = nodes.new('ShaderNodeOutputMaterial')
links.new(hair_bsdf.outputs[0], out.inputs[0])

head.data.materials.append(mat_hair)
hair_mat_slot = len(head.data.materials) 

# ── HELPER: configure a particle system ───────────────────────
def setup_psys(psys, vgroup, length, count,
               kink, amplitude, frequency,
               child_count, roughness, 
               clump, clump_shape, radius):
    psys.vertex_group_density = vgroup
    psys.vertex_group_length  = vgroup

    s = psys.settings
    s.type         = 'HAIR'
    s.count        = count
    s.hair_length  = length
    s.render_type  = 'PATH'
    s.display_step = 5
    s.material     = hair_mat_slot

    s.kink = kink
    s.kink_amplitude = amplitude
    s.kink_amplitude_random = 0.6 
    s.kink_frequency = frequency
    s.kink_shape     = 0.3

    s.roughness_1        = roughness
    s.roughness_2        = roughness * 0.75
    s.roughness_endpoint = roughness * 1.5
    s.roughness_2_size   = 0.3

    s.child_type = 'INTERPOLATED'
    s.rendered_child_count = child_count
    s.child_percent = 100 
    s.child_length = 1.0
    s.child_length_threshold = 0.2 
    
    s.clump_factor = clump
    s.clump_shape = clump_shape
    s.child_radius = radius
    s.child_roundness = 1.0 

# ── PARTICLE SYSTEM 1: CROWN (Big Curls) ──────────────────────
bpy.context.view_layer.objects.active = head
bpy.ops.object.particle_system_add()
setup_psys(
    psys       = head.particle_systems[-1],
    vgroup     = "CrownCurls",
    length     = 0.55,
    count      = 200,    # DRASTICALLY DECREASED: Separates the anchors into individual clumps
    kink       = 'CURL',
    amplitude  = 0.25,  
    frequency  = 2.5,   
    child_count= 150,   # DRASTICALLY INCREASED: Fills those few clumps with plenty of hair
    roughness  = 0.08,
    clump      = 0.95,  # Tighter tip clumping to define the locks
    clump_shape= -0.2,  
    radius     = 0.06,  # Increased slightly to give the distinct clumps some volume
)
head.particle_systems[-1].name = "CrownCurls"

# ── PARTICLE SYSTEM 2: MID (Small Random Curls) ───────────────
bpy.ops.object.particle_system_add()
setup_psys(
    psys       = head.particle_systems[-1],
    vgroup     = "MidCurls",
    length     = 0.35,
    count      = 80,    # DECREASED
    kink       = 'CURL',
    amplitude  = 0.12,  
    frequency  = 5.0,   
    child_count= 80,    # INCREASED
    roughness  = 0.1,
    clump      = 0.9,
    clump_shape= -0.1,
    radius     = 0.04,  
)
head.particle_systems[-1].name = "MidCurls"

# ── PARTICLE SYSTEM 3: SHORT SIDES & BACK ─────────────────────
bpy.ops.object.particle_system_add()
setup_psys(
    psys       = head.particle_systems[-1],
    vgroup     = "ShortSides",
    length     = 0.07,
    count      = 200,   # Left high because this is faded/uniform hair
    kink       = 'WAVE',
    amplitude  = 0.02,
    frequency  = 6.0,
    child_count= 40,
    roughness  = 0.04,
    clump      = 0.3,   
    clump_shape= 0.3,
    radius     = 0.2,
)
head.particle_systems[-1].name = "ShortSides"

# ── LIGHTING ──────────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(3, -3, 5))
bpy.context.active_object.data.energy = 3

bpy.ops.object.light_add(type='AREA', location=(-2, -1, 2))
fill = bpy.context.active_object
fill.data.energy = 50
fill.data.size   = 2

# ── CAMERA ────────────────────────────────────────────────────
bpy.ops.object.camera_add(location=(0, -3.5, 0.2))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(88), 0, 0)
bpy.context.scene.camera = cam

print("Done! Split into Crown, Mid, and Sides with randomized borders and distinct scattered clumps.")