import bpy

# ── 1. SET YOUR EXPORT PATH HERE ──────────────────────────────
export_path = "C:/coconut_head.glb"  # Mac/Linux users: "/Users/yourname/Desktop/coconut_head.glb"

def export_hair_to_glb(filepath):
    head = bpy.data.objects.get("Head")
    if not head:
        print("Head object not found!")
        return

    # Deselect everything
    bpy.ops.object.select_all(action='DESELECT')
    
    hair_objects = []
    
    # ── PHASE 1: Convert Particles to Mesh ────────────────────
    # Find all particle modifiers on the head
    particle_mods = [m for m in head.modifiers if m.type == 'PARTICLE_SYSTEM']
    
    for mod in particle_mods:
        bpy.context.view_layer.objects.active = head
        head.select_set(True)
        
        # We need a 3D Viewport context to run the convert operator
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                with bpy.context.temp_override(area=area):
                    bpy.ops.object.modifier_convert(modifier=mod.name)
                break
        
        # The operator creates a new object (the converted hair) and selects it
        new_obj = bpy.context.active_object
        if new_obj != head:
            hair_objects.append(new_obj)
        
        head.select_set(False)

    if not hair_objects:
        print("No hair was converted.")
        return

    # ── PHASE 2: Give Lines Thickness (Curve Bevel) ───────────
    # Select and join all the new hair meshes into one object
    bpy.ops.object.select_all(action='DESELECT')
    for obj in hair_objects:
        obj.select_set(True)
        
    bpy.context.view_layer.objects.active = hair_objects[0]
    bpy.ops.object.join()
    hair_mesh = bpy.context.active_object
    hair_mesh.name = "Solid_Hair"

    # Convert to curve, add thickness, convert back to mesh
    bpy.ops.object.convert(target='CURVE')
    
    # Keep depth small and resolution at 0 to prevent file sizes from exploding!
    hair_mesh.data.bevel_depth = 0.003
    hair_mesh.data.bevel_resolution = 0 
    
    bpy.ops.object.convert(target='MESH')

    # ── PHASE 3: Standard GLB Material ────────────────────────
    mat_glb = bpy.data.materials.new(name="GLTF_Hair_Mat")
    mat_glb.use_nodes = True
    bsdf = mat_glb.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.05, 0.02, 0.01, 1.0) # Dark brown
        bsdf.inputs["Roughness"].default_value = 0.7

    # Replace the incompatible hair material
    hair_mesh.data.materials.clear()
    hair_mesh.data.materials.append(mat_glb)

    # ── PHASE 4: Export to GLB ────────────────────────────────
    bpy.ops.object.select_all(action='DESELECT')
    head.select_set(True)
    hair_mesh.select_set(True)
    
    # Delete the original particle systems from the head so they don't corrupt the export
    for mod in head.modifiers:
        if mod.type == 'PARTICLE_SYSTEM':
            head.modifiers.remove(mod)

    # Export selected objects
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        use_selection=True,
        export_format='GLB'
    )
    
    print(f"Success! GLB file saved to: {filepath}")

# Run the function
export_hair_to_glb(export_path)