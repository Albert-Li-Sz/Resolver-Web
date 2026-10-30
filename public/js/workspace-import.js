const select=document.getElementById('workspaceSelect');
async function load(){try{const r=await fetch('/api/workspaces');if(!r.ok)throw Error();const list=await r.json();select.replaceChildren(...list.map(w=>{const o=document.createElement('option');o.value=w.id;o.textContent=w.name;return o;}));}catch{document.getElementById('workspaceImportStatus').textContent='共享赛事暂不可用';}}
document.getElementById('workspaceImportBtn').addEventListener('click',async()=>{
 const status=document.getElementById('workspaceImportStatus');if(!select.value){status.textContent='请先在 Live 中创建赛事工作区';return;}
 try{const r=await fetch(`/api/workspaces/${select.value}/snapshot`);if(!r.ok)throw Error();const {contest}=await r.json();document.dispatchEvent(new CustomEvent('resolver:workspace-import',{detail:{contest}}));}catch{status.textContent='载入失败，请重试';}
});load();
