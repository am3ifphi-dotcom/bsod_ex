import * as THREE from 'three';

/**
 * Pushes every texture inside a loaded GLB toward the sharpest filtering the GPU allows.
 *
 * The room/architecture shaders are all analytically lit (no PBR maps), so almost the entire
 * "image quality" budget of a scene lands on these albedo maps. Anisotropic filtering is what
 * stops the floor, rug and concrete from smearing into mush at grazing angles when you look
 * across the room or down the causeway.
 */
export function maximizeTextureQuality(root: THREE.Object3D, anisotropy = 8): void {
  const seen = new Set<THREE.Texture>();

  const upgrade = (tex: THREE.Texture | null | undefined) => {
    if (!tex || seen.has(tex)) return;
    seen.add(tex);
    tex.anisotropy = anisotropy;
    if (tex.minFilter === THREE.NearestFilter || tex.minFilter === THREE.NearestMipmapNearestFilter) {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    tex.needsUpdate = true;
  };

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      if (!raw) continue;
      for (const value of Object.values(raw as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) upgrade(value);
      }
    }
  });
}
