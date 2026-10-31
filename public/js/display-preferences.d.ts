import type { OutputProfile } from './output-profile';
export function normalizeDisplay(raw?: any): OutputProfile;
export function displayGeometry(raw: any, width: number, height: number): {left:number;top:number;width:number;height:number;logicalWidth:number;logicalHeight:number};
export function renderDimensions(width?:number,resolution?:string):{width:number;height:number};
export const DISPLAY_DEFAULTS: OutputProfile;
