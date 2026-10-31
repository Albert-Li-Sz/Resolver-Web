// @ts-nocheck
// Only transport changes here. The wrapper geometry is upstream TeamMediaHolder.
import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import styled from 'styled-components';
import {MediaReader} from '../../../../../src/media';
export const MediaContext=createContext({headers:{},muted:true,volume:0,audioMediaId:''});
const MediaWrapper=styled.div`overflow:hidden;text-align:right;width:100%;height:${p=>p.$vertical?'100%':'auto'};max-width:100%;max-height:100%;`;
const Placeholder=styled.div`display:grid;place-items:center;width:100%;aspect-ratio:16/9;background:#242425;color:#aaa;font:22px Helvetica,serif;`;
export function TeamMediaHolder({media,onLoadStatus,className}){
 const host=useRef(null);const options=useContext(MediaContext);const latest=useRef(options);latest.current=options;
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  setReady(false);
  if(!media?.sourceId){onLoadStatus(true);return;}
  const reader=new MediaReader(media.sourceId,options.headers);const video=reader.video;video.dataset.mediaId=media.sourceId;
  video.style.cssText=`width:${media.vertical?'auto':'100%'};height:${media.vertical?'100%':'auto'};overflow:hidden;display:block;`;
  host.current?.append(video);onLoadStatus(true);
  const timer=setInterval(()=>{setReady(reader.ready);const o=latest.current;reader.audio(o.volume,o.muted||!!o.audioMediaId&&o.audioMediaId!==media.sourceId);},250);
  return()=>{clearInterval(timer);reader.close();video.remove();};
 },[media?.sourceId,media?.streamRevision,JSON.stringify(options.headers)]);
 if(media?.type==='Image')return <MediaWrapper className={className} $vertical={media.vertical}><img crossOrigin="anonymous" src={media.url} style={{width:'100%',height:'auto'}} onLoad={()=>onLoadStatus(true)}/></MediaWrapper>;
 return <MediaWrapper className={className} $vertical={media?.vertical} style={{position:'relative',minHeight:media?.sourceId?undefined:'100%'}}><div ref={host}/>{!ready&&<Placeholder style={media?.sourceId?{position:'absolute',inset:0}:undefined}>{media?.sourceId?'视频暂不可用':'等待媒体来源'}</Placeholder>}</MediaWrapper>;
}
