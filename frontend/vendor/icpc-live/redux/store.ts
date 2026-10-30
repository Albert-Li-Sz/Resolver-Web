// @ts-nocheck
// Platform adapter: an independent upstream store for each preview/output.
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { contestInfoReducer } from './contest/contestInfo';
import { queueReducer } from './contest/queue';
import scoreboardReducer from './contest/scoreboard';
import { tickerReducer } from './ticker';
const reducer=combineReducers({contestInfo:contestInfoReducer,queue:queueReducer,scoreboard:scoreboardReducer,ticker:tickerReducer});
export function createOverlayStore(){
 return configureStore({reducer:(state,action)=>action.type==='PLATFORM_SNAPSHOT'?{...state,...action.payload}:reducer(state,action),middleware:getDefault=>getDefault({immutableCheck:false,serializableCheck:false}),devTools:false});
}
export const store=createOverlayStore();
export type RootState=ReturnType<typeof store.getState>;
export type AppDispatch=typeof store.dispatch;
