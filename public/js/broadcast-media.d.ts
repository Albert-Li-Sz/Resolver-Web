type Media = {
  id: string;
  teamId?: string;
  role?: string;
  workspaceId?: string;
};
type Scene = {
  layout: string;
  teamIds?: string[];
  mediaIds?: string[];
  audioMediaId?: string;
};
export function sceneMediaSlots(
  scene: Scene,
  media: Media[],
  workspaceId?: string,
): { primary?: string; secondary?: string }[];
export function sceneMediaIds(
  scene: Scene,
  media: Media[],
  workspaceId?: string,
): string[];
