# Gaussian Splat Assets

Trained 3D Gaussian Splatting point clouds (`.ply`) live here.

## Workflow (do this once per scene, then commit the result)

1. **Capture** 40–150 overlapping photos of the subject → `gsplat-tools/<scene>/input/`
2. **COLMAP** recovers camera poses:
   `colmap automatic_reconstructor --workspace_path <scene> --image_path <scene>/input`
3. **Brush** trains on the COLMAP output and exports a `.ply`
4. **Copy** the exported `.ply` into this folder and commit it.

## Important

- `.ply` files are **git-ignored** (see the `*.ply` rule in the repo `.gitignore`). They are
  large generated assets, **not committed** to the repo — do not force-add them.
- **How to get the splat:** copy the `.ply` into this folder from the shared drive
  (or generate your own). The engine loads it locally from `assets/splats/`.
- The authoring tools (COLMAP, Brush) live **outside** this repo in `gsplat-tools/`.
  Teammates render the `.ply` with the engine's OpenGL splat renderer and never need
  CUDA, COLMAP, or Brush.
