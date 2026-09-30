const $ = s => document.querySelector(s);
const video = $("#video");
let videoName = "";
let items = [
  {id:1,start:"00:00:00,000",end:"00:00:05,000",text:"Hello! This is a foreign video.",khmer:"សួស្តី! នេះជាវីដេអូបរទេស។"},
  {id:2,start:"00:00:05,000",end:"00:00:10,000",text:"Welcome to the Khmer translator demo.",khmer:"សូមស្វាគមន៍មកកាន់កម្មវិធីបកប្រែជាភាសាខ្មែរ។"},
  {id:3,start:"00:00:10,000",end:"00:00:15,000",text:"Thank you for watching.",khmer:"អរគុណសម្រាប់ការទស្សនា។"}
];

function setStatus(msg){ $("#status").textContent = msg; }

function renderTable(){
  const body = $("#subtitleBody");
  body.innerHTML = "";
  items.forEach((x,i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="num">${i+1}</td>
      <td><input data-i="${i}" data-k="start" value="${esc(x.start)}"></td>
      <td><input data-i="${i}" data-k="end" value="${esc(x.end)}"></td>
      <td><input data-i="${i}" data-k="text" value="${esc(x.text)}"></td>
      <td><input data-i="${i}" data-k="khmer" value="${esc(x.khmer||"")}"></td>
      <td><button class="speak" data-i="${i}">🔊</button></td>
      <td><button class="delete" data-i="${i}">×</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll("input").forEach(inp=>inp.addEventListener("input", e=>{
    items[+e.target.dataset.i][e.target.dataset.k]=e.target.value;
    renderTimeline();
  }));
  body.querySelectorAll(".delete").forEach(b=>b.onclick=()=>{
    items.splice(+b.dataset.i,1); renderTable(); renderTimeline();
  });
  body.querySelectorAll(".speak").forEach(b=>b.onclick=()=>speak(items[+b.dataset.i].khmer||items[+b.dataset.i].text));
  renderTimeline();
}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;")}

function toSeconds(t){
  const m=t.match(/(\d+):(\d+):(\d+)[,.](\d+)/); if(!m)return 0;
  return +m[1]*3600 + +m[2]*60 + +m[3] + (+m[4]/1000);
}
function renderTimeline(){
  const track=$("#track"); track.innerHTML="";
  const total=Math.max(video.duration||60,60);
  items.forEach((x,i)=>{
    const s=toSeconds(x.start), e=toSeconds(x.end);
    const clip=document.createElement("div");
    clip.className="clip"; clip.style.left=(s/total*100)+"%"; clip.style.width=Math.max((e-s)/total*100,4)+"%";
    clip.textContent=(i+1)+". "+(x.khmer||x.text);
    track.appendChild(clip);
  });
}

$("#videoInput").onchange = async e=>{
  const f=e.target.files[0]; if(!f)return;
  video.src=URL.createObjectURL(f); $("#emptyVideo").style.display="none";
  setStatus("Uploading…");
  const fd=new FormData(); fd.append("video",f);
  try{
    const r=await fetch("/api/upload",{method:"POST",body:fd}); const d=await r.json();
    if(!r.ok) throw new Error(d.error||"Upload failed");
    videoName=d.filename; setStatus("Video loaded");
  }catch(err){setStatus(err.message)}
};

$("#srtInput").onchange=async e=>{
  const f=e.target.files[0]; if(!f)return;
  const fd=new FormData(); fd.append("srt",f);
  const r=await fetch("/api/parse-srt",{method:"POST",body:fd}); const d=await r.json();
  if(!r.ok)return setStatus(d.error);
  items=d.items; renderTable(); setStatus(`Loaded ${items.length} subtitles`);
};

$("#translateBtn").onclick=async()=>{
  setStatus("Translating…");
  const r=await fetch("/api/translate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items,target:"km"})});
  const d=await r.json();
  if(!r.ok)return setStatus(d.error||"Translation failed");
  items=d.items; renderTable(); setStatus("Translated to Khmer");
};

$("#saveBtn").onclick=async()=>{
  const r=await fetch("/api/save-srt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})});
  const d=await r.json(); if(!r.ok)return setStatus(d.error);
  const a=document.createElement("a"); a.href=d.url; a.download=d.filename; a.click(); setStatus("SRT saved");
};

$("#renderBtn").onclick=async()=>{
  if(!videoName)return setStatus("Upload a video first");
  setStatus("Rendering with FFmpeg…");
  const r=await fetch("/api/render",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:videoName,items})});
  const d=await r.json();
  if(!r.ok)return setStatus(d.error||d.details||"Render failed");
  window.open(d.url,"_blank"); setStatus("Rendered video ready");
};

$("#addBtn").onclick=()=>{
  const last=items[items.length-1];
  items.push({id:items.length+1,start:last?.end||"00:00:00,000",end:"00:00:05,000",text:"New subtitle",khmer:""});
  renderTable();
};
$("#clearBtn").onclick=()=>{items=[];renderTable();setStatus("Cleared")};
$("#extractBtn").onclick=()=>setStatus("Demo mode: connect Whisper for automatic transcription");
$("#playBtn").onclick=()=>video.play(); $("#pauseBtn").onclick=()=>video.pause();
$("#fontSize").oninput=e=>$("#caption").style.fontSize=e.target.value+"px";
$("#opacity").oninput=e=>$("#caption").style.opacity=e.target.value/100;

video.ontimeupdate=()=>{
  const now=video.currentTime;
  $("#timeLabel").textContent=new Date(now*1000).toISOString().slice(14,19);
  const active=items.find(x=>now>=toSeconds(x.start)&&now<toSeconds(x.end));
  $("#caption").textContent=active?.khmer||"";
};
video.onloadedmetadata=renderTimeline;

function speak(text){
  if(!("speechSynthesis" in window)) return setStatus("Browser TTS is not supported");
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  const voices=speechSynthesis.getVoices();
  u.voice=voices.find(v=>v.lang.toLowerCase().startsWith("km")) || voices.find(v=>v.lang.toLowerCase().startsWith("th")) || null;
  u.lang="km-KH"; u.rate=.95; speechSynthesis.speak(u);
}
$("#voiceBtn").onclick=()=>{
  const first=items.find(x=>x.khmer); if(first)speak(first.khmer);
};
renderTable();
