var publicandoMasivo=false;
function mostrarTab(id,btn){document.getElementById("sin-publicar").style.display=id==="sin-publicar"?"":"none";document.getElementById("publicados").style.display=id==="publicados"?"":"none";document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));btn.classList.add("active");}
function filtrar(q){const cards=document.querySelectorAll(".card");q=q.toLowerCase();cards.forEach(c=>{const titulo=c.querySelector(".card-title").textContent.toLowerCase();const skuEl=c.querySelector(".card-sku");const sku=skuEl?skuEl.textContent.toLowerCase():"";c.style.display=(titulo.includes(q)||sku.includes(q))?"":"none";});}
function seleccionarTodos(){const tabActiva=document.getElementById("sin-publicar").style.display!=="none"?"sin-publicar":"publicados";const visible=[...document.getElementById(tabActiva).querySelectorAll(".sel-producto")].filter(c=>c.closest(".card").style.display!=="none");const allChecked=visible.every(c=>c.checked);visible.forEach(c=>c.checked=!allChecked);}
function mostrarToast(msg,bg){let t=document.getElementById("tp");if(!t){t=document.createElement("div");t.id="tp";t.style.cssText="position:fixed;bottom:24px;right:24px;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);min-width:220px;color:white";document.body.appendChild(t);}t.style.background=bg||"#1d1d1f";t.textContent=msg;}
async function publicar(id){const btn=document.getElementById("pub-"+id);const statusEl=document.getElementById("status-"+id);btn.disabled=true;try{const v0=await fetch("/api/variantes/"+id).then(r=>r.json());btn.textContent="Subiendo... 0/"+(v0.total||1);const data=await fetch("/publicar/"+id,{method:"POST"}).then(r=>r.json());if(data.ok){const ok=data.links.filter(l=>!l.error);const fail=data.links.filter(l=>l.error);btn.style.background="var(--accent2)";btn.textContent="Publicado! ("+ok.length+"/"+data.links.length+")";statusEl.style.color="var(--accent2)";statusEl.innerHTML=ok.map(l=>"<a href='"+l.url+"' target='_blank'>"+l.color+"</a>").join(" | ")+(fail.length>0?"<br><span style='color:red'>No se pudo: "+fail.map(l=>l.color).join(", ")+"</span>":"");if(!publicandoMasivo)setTimeout(()=>location.reload(),3000);}else{btn.disabled=false;btn.textContent="Publicar en ML";statusEl.style.color="var(--danger)";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.textContent="Error";}}
async function actualizar(id){const btn=document.getElementById("pub-"+id);btn.disabled=true;btn.textContent="Actualizando...";try{const data=await fetch("/actualizar/"+id,{method:"POST"}).then(r=>r.json());btn.disabled=false;btn.textContent="Actualizar en ML";const statusEl=document.getElementById("status-"+id);if(data.ok){statusEl.style.color="var(--accent2)";statusEl.textContent="Actualizado!";}else{statusEl.style.color="var(--danger)";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.textContent="Actualizar en ML";}}
async function eliminar(id){if(!confirm("Eliminar de Mercado Libre?"))return;const btn=document.getElementById("del-"+id);btn.disabled=true;btn.textContent="...";const statusEl=document.getElementById("status-"+id);try{const data=await fetch("/eliminar/"+id,{method:"POST"}).then(r=>r.json());if(data.ok){statusEl.style.color="var(--accent2)";statusEl.textContent="Eliminado";setTimeout(()=>location.reload(),1500);}else{btn.disabled=false;btn.innerHTML="&#128465;";statusEl.style.color="var(--danger)";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.innerHTML="&#128465;";}}
async function eliminarSeleccionados(){const ids=[...document.querySelectorAll(".sel-producto:checked")].map(c=>c.value);if(!ids.length){alert("Selecciona al menos un producto");return;}if(!confirm("Eliminar "+ids.length+" publicaciones de ML?"))return;for(const id of ids){await eliminar(id);await new Promise(r=>setTimeout(r,300));}}
async function publicarSeleccionados(){
  publicandoMasivo=true;
  const ids=[...document.querySelectorAll(".sel-producto:checked")].map(c=>c.value);
  if(!ids.length){alert("Selecciona al menos un producto");publicandoMasivo=false;return;}
  const resultados=[];
  for(let i=0;i<ids.length;i++){
    mostrarToast("Subiendo "+(i+1)+"/"+ids.length+" articulos...");
    const card=document.querySelector(".card input[value='"+ids[i]+"']");
    const nombre=card?card.closest(".card").querySelector(".card-title").textContent:"Articulo "+ids[i];
    try{
      const data=await fetch("/publicar/"+ids[i],{method:"POST"}).then(r=>r.json());
      if(data.ok){resultados.push({nombre,ok:data.links.filter(l=>!l.error).length,errores:data.links.filter(l=>l.error).map(l=>l.error)});}
      else{resultados.push({nombre,ok:0,errores:[data.error]});}
    }catch(e){resultados.push({nombre,ok:0,errores:[e.message]});}
    await new Promise(r=>setTimeout(r,500));
  }
  publicandoMasivo=false;
  const tp=document.getElementById("tp");if(tp)tp.remove();
  const okL=resultados.filter(r=>r.ok>0);
  const failL=resultados.filter(r=>r.ok===0);
  const m=document.createElement("div");
  m.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center";
  const inner=document.createElement("div");
  inner.style.cssText="background:white;border-radius:16px;padding:28px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto";
  let html="<h3 style='font-size:17px;font-weight:600;margin-bottom:16px'>Resumen</h3>";
  if(okL.length){html+="<p style='font-size:12px;color:gray;margin-bottom:6px'>PUBLICADOS ("+okL.length+")</p>"+okL.map(r=>"<p style='font-size:13px;padding:6px 0;border-bottom:1px solid #eee'>"+r.nombre+"</p>").join("");}
  if(failL.length){html+="<p style='font-size:12px;color:gray;margin:12px 0 6px'>NO SE PUDO ("+failL.length+")</p>"+failL.map(r=>"<p style='font-size:13px;padding:6px 0;color:red'>"+r.nombre+(r.errores[0]?" - "+r.errores[0]:"")+"</p>").join("");}
  html+="<button id='btnAceptar' style='width:100%;padding:10px;background:#0071e3;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-top:16px'>Aceptar</button>";
  inner.innerHTML=html;
  m.appendChild(inner);
  document.body.appendChild(m);
  document.getElementById("btnAceptar").onclick=function(){m.remove();location.reload();};
}