/** Shared media selection for authorization and the original Live-v3 layouts. */
export function sceneMediaSlots(scene, media, workspaceId) {
  const count = scene.layout === "quad" ? 4 : scene.layout === "dual" ? 2 : 1;
  return Array.from({ length: count }, (_, i) => {
    const candidates = media.filter(
      (m) =>
        scene.teamIds?.[i] &&
        m.teamId === scene.teamIds[i] &&
        ((!workspaceId && !m.workspaceId) || m.workspaceId === workspaceId),
    );
    const primary =
      scene.mediaIds?.[i] || candidates.find((m) => m.role === "camera")?.id;
    const primaryRole = media.find((m) => m.id === primary)?.role;
    const secondary =
      count <= 2
        ? candidates.find(
            (m) =>
              m.id !== primary &&
              m.role === (primaryRole === "desktop" ? "camera" : "desktop"),
          )?.id
        : undefined;
    return { primary, secondary };
  });
}
export function sceneMediaIds(scene, media, workspaceId) {
  return [
    ...new Set(
      sceneMediaSlots(scene, media, workspaceId)
        .flatMap((s) => [s.primary, s.secondary])
        .concat(scene.audioMediaId || [])
        .filter(Boolean),
    ),
  ];
}
