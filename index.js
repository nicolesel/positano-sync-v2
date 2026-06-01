const express = require('express');
const axios   = require('axios');
const app     = express();
const fs      = require('fs');
app.use(express.json());

const STORE_ID         = '4784990';
const TN_TOKEN         = '2ac2da90bccc350d041d1fbaddd5f3e664f2e22f';
const ML_CLIENT_ID     = '7264088506318196';
const ML_CLIENT_SECRET = 'sXlSgTEWWRGrOMHGDPg3JiMPSFSQUBAV';
const MAPEO_FILE       = 'C:\\positano-publisher\\mapeo.json';
const NOTIF_FILE       = 'C:\\positano-publisher\\notificaciones.json';

let mapeo = fs.existsSync(MAPEO_FILE) ? JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf8')) : {};
let notificaciones = fs.existsSync(NOTIF_FILE) ? JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8')) : [];
function guardarMapeo() { fs.writeFileSync(MAPEO_FILE, JSON.stringify(mapeo, null, 2), 'utf8'); }
function agregarNotif(msg) {
  notificaciones.unshift({ fecha: new Date().toLocaleString('es-AR'), msg, leida: false });
  if (notificaciones.length > 100) notificaciones.pop();
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(notificaciones, null, 2), 'utf8');
}

let mlToken = 'APP_USR-7264088506318196-052914-20805ab9cc542f32cb6c6ac4eca8784c-303503376';

async function renovarTokenML() {
  try {
    const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'client_credentials', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET,
    });
    mlToken = data.access_token;
    console.log('Token ML renovado');
  } catch(e) { console.error('Error renovando token:', e.message); }
}
setInterval(renovarTokenML, 5 * 60 * 60 * 1000);
renovarTokenML().then(() => { sincronizarStock(); setInterval(sincronizarStock, 60*1000); });

const MARCAS = ['Zaphir','Trendy','Oreiro','Everlast','Discovery','Muaa','Alpine','Pierre Cardin','Bossi','Peyton','Hummer','Basilea','Miss Unique','Travel Tech','JOUP','Barbara','Amayra','Disney','Wilson','Unicross','Polo','Head'];
const CATEGORIAS = {
  'mochila':{ id:'MLA120350',tipo:'BACKPACK_TYPE',valor:'Urbana' },'morral':{ id:'MLA120350',tipo:'BACKPACK_TYPE',valor:'Urbana' },
  'cartera':{ id:'MLA120353',tipo:null,valor:null },'bolso':{ id:'MLA120353',tipo:null,valor:null },
  'billetera':{ id:'MLA3815',tipo:null,valor:null },'rinonera':{ id:'MLA120357',tipo:null,valor:null },
  'bandolera':{ id:'MLA120353',tipo:null,valor:null },'valija':{ id:'MLA113268',tipo:null,valor:null },
  'paraguas':{ id:'MLA1748',tipo:null,valor:null },'gorra':{ id:'MLA1510',tipo:null,valor:null },'cinturon':{ id:'MLA1656',tipo:null,valor:null },
};

function detectarMarca(nombre,brand){ if(brand)return brand; const n=nombre.toLowerCase(); for(const m of MARCAS){if(n.includes(m.toLowerCase()))return m;} return 'Generica'; }
function detectarCategoria(nombre){ const n=nombre.toLowerCase(); for(const[key,cat]of Object.entries(CATEGORIAS)){if(n.includes(key))return cat;} return{id:'MLA120353',tipo:null,valor:null}; }
function generarEAN(){ const base=String(Date.now()).slice(-12); let sum=0; for(let i=0;i<12;i++)sum+=parseInt(base[i])*(i%2===0?1:3); return base+((10-(sum%10))%10); }

async function fetchAllProducts() {
  let all=[],page=1;
  while(true){
    const{data}=await axios.get('https://api.tiendanube.com/v1/'+STORE_ID+'/products?per_page=50&page='+page,{headers:{'Authentication':'bearer '+TN_TOKEN,'User-Agent':'PositanoPublisher/1.0'}});
    if(!data.length)break; all=all.concat(data); if(data.length<50)break; page++;
  }
  return all.reverse();
}

function buildVariations(p){
  const imageMap={};
  for(const img of(p.images||[]))imageMap[img.id]=img.src;
  const colorMap={};
  for(const v of p.variants){
    const color=((v.values&&v.values[0]&&v.values[0].es)||'Unico').trim();
    const key=color.toLowerCase();
    if(!colorMap[key])colorMap[key]={stock:0,imageIds:new Set(),colorName:color,sku:v.sku};
    colorMap[key].stock+=parseInt(v.stock)||0;
    if(v.image_id)colorMap[key].imageIds.add(v.image_id);
  }
  return Object.values(colorMap).map(info=>{
    const imgs=Array.from(info.imageIds).map(id=>imageMap[id]).filter(Boolean);
    return{color:info.colorName,stock:info.stock,sku:info.sku,imageSrc:imgs[0]||(p.images&&p.images[0]&&p.images[0].src),imagesPorColor:imgs};
  });
}

function estaPublicado(vars){ return vars.some(v=>v.sku&&mapeo[v.sku+'_'+v.color]); }

function armarDescripcion(nombre,marca,color,colores,descTN){
  const descLimpia=descTN?descTN.replace(/<[^>]*>/g,'').trim():'';
  let desc=nombre.toUpperCase()+'\n\n';
  if(descLimpia&&descLimpia.length>80){ desc+=descLimpia+'\n\n'; }
  else{ desc+=nombre+' de la marca '+marca+'. Ideal para el uso diario, combina estilo y funcionalidad. Disponible en multiples colores.\n\n'; }
  desc+='CARACTERISTICAS:\n- Marca: '+marca+'\n- Color: '+color+'\n- Disponible en: '+colores+'\n\nProducto nuevo, original. Envios a todo el pais.';
  return desc;
}

async function publicarColorEnML(titulo,cat,precio,marca,stock,color,pictures,descripcion,extraAttr,sku){
  const attrs=[
    {id:'BRAND',value_name:marca},{id:'MODEL',value_name:sku||titulo.slice(0,60)},
    {id:'COLOR',value_name:color},{id:'GTIN',value_name:generarEAN()},
    {id:'EMPTY_GTIN_REASON',value_id:'17055160'},{id:'VALUE_ADDED_TAX',value_id:'48405909'},{id:'IMPORT_DUTY',value_id:'49553239'},
  ];
  if(extraAttr)attrs.push(extraAttr);
  const body={category_id:cat.id,price:precio,currency_id:'ARS',available_quantity:stock>0?stock:0,buying_mode:'buy_it_now',listing_type_id:'bronze',condition:'new',family_name:titulo.slice(0,60),pictures,attributes:attrs};
  const{data}=await axios.post('https://api.mercadolibre.com/items',body,{headers:{'Authorization':'Bearer '+mlToken,'Content-Type':'application/json'}});
  if(descripcion){try{await axios.post('https://api.mercadolibre.com/items/'+data.id+'/description',{plain_text:descripcion},{headers:{'Authorization':'Bearer '+mlToken,'Content-Type':'application/json'}});}catch(e){}}
  return data;
}

let ultimaRevision=new Date(Date.now()-24*60*60*1000).toISOString();
let logsSync=[];
let stockTNCache={};

async function sincronizarStock(){ console.log('Sync corriendo...', new Date().toLocaleTimeString('es-AR'));
  try{
    const logEntry={fecha:new Date().toLocaleString('es-AR'),actualizaciones:[]};
    logsSync.unshift(logEntry); if(logsSync.length>50)logsSync.pop();
    const products=await fetchAllProducts();
    for(const p of products){
      for(const v of(p.variants||[])){
        const key=p.id+'_'+v.id; const stockAnterior=stockTNCache[key]; const stockActual=parseInt(v.stock)||0; 
        if(stockAnterior!==undefined&&stockAnterior!==stockActual){
          logEntry.actualizaciones.push('TN: '+(v.sku||(p.name&&p.name.es))+' '+stockAnterior+' -> '+stockActual);
          agregarNotif('Stock cambiado en TN: '+(v.sku||(p.name&&p.name.es))+' -> '+stockActual);
          const mlId=v.sku&&mapeo[v.sku+'_'+((v.values&&v.values[0]&&v.values[0].es)||'Unico')];
          if(mlId){try{await axios.put('https://api.mercadolibre.com/items/'+mlId,{available_quantity:stockActual},{headers:{'Authorization':'Bearer '+mlToken,'Content-Type':'application/json'}});}catch(e){}}
        }
        stockTNCache[key]=stockActual;
      }
    }
    const{data:ordersML}=await axios.get('https://api.mercadolibre.com/orders/search?seller=303503376&order.status=paid&order.date_created.from='+ultimaRevision,{headers:{'Authorization':'Bearer '+mlToken}});
    for(const order of(ordersML.results||[])){
      for(const item of order.order_items){
        const mlId=item.item.id; const qty=item.quantity;
        const skuEntry=Object.entries(mapeo).find(([k,v])=>v===mlId);
        if(skuEntry){
          const sku=skuEntry[0].split('_')[0];
          const p=products.find(x=>x.variants&&x.variants.some(v=>v.sku===sku));
          if(p){const variant=p.variants.find(v=>v.sku===sku);if(variant){const nuevoStock=Math.max(0,(variant.stock||0)-qty);await axios.put('https://api.tiendanube.com/v1/'+STORE_ID+'/products/'+p.id+'/variants/'+variant.id,{stock:nuevoStock},{headers:{'Authentication':'bearer '+TN_TOKEN,'User-Agent':'PositanoPublisher/1.0'}});logEntry.actualizaciones.push('Venta ML: '+sku+' -> '+nuevoStock);agregarNotif('Venta en ML: '+sku+' x'+qty);}}
        }
      }
    }
    const mlIdsEnMapeo=[...new Set(Object.values(mapeo))];
    for(const mlId of mlIdsEnMapeo){
      try{const{data:item}=await axios.get('https://api.mercadolibre.com/items/'+mlId,{headers:{'Authorization':'Bearer '+mlToken}});
        if(item.status==='closed'||item.status==='deleted'){const keys=Object.keys(mapeo).filter(k=>mapeo[k]===mlId);for(const k of keys)delete mapeo[k];guardarMapeo();agregarNotif('Eliminado de ML: '+mlId);}
      }catch(e){if(e.response&&e.response.status===404){const keys=Object.keys(mapeo).filter(k=>mapeo[k]===mlId);for(const k of keys)delete mapeo[k];guardarMapeo();}}
    }
    ultimaRevision=new Date().toISOString();
  }catch(e){console.error('Error sync:',e.message, e.config && e.config.url);}
}


app.get('/api/stocks', async (req, res) => {
  try {
    const products = await fetchAllProducts();
    const stocks = products.map(p => ({
      id: p.id,
      stock: p.variants ? p.variants.reduce((s, v) => s + (parseInt(v.stock) || 0), 0) : 0
    }));
    res.json(stocks);
  } catch(e) { res.json([]); }
});

app.get('/api/notificaciones',(req,res)=>res.json(notificaciones));
app.post('/api/notificaciones/leer',(req,res)=>{notificaciones=notificaciones.map(n=>({...n,leida:true}));fs.writeFileSync(NOTIF_FILE,JSON.stringify(notificaciones,null,2),'utf8');res.json({ok:true});});

app.post('/eliminar/:id', async (req, res) => {
  try {
    const products = await fetchAllProducts();
    const p = products.find(x => x.id == req.params.id);
    if (!p) return res.json({ ok: false, error: 'Producto no encontrado' });
    const vars = buildVariations(p);
    const eliminados = [];
    for (const v of vars) {
      const mlId = v.sku && mapeo[v.sku + '_' + v.color];
      if (mlId) {
        try {
          await axios.put('https://api.mercadolibre.com/items/' + mlId,
            { status: 'closed' },
            { headers: { 'Authorization': 'Bearer ' + mlToken, 'Content-Type': 'application/json' }}
          );
          delete mapeo[v.sku + '_' + v.color];
          eliminados.push(v.color);
        } catch(e) { console.log('Error eliminando:', e.message); }
      }
    }
    guardarMapeo();
    const nombre = (p.name && (p.name.es || p.name.en)) || 'Producto';
    agregarNotif('Eliminado de ML: ' + nombre);
    res.json({ ok: true, eliminados });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/actualizar/:id', async (req, res) => {
  try {
    const products = await fetchAllProducts();
    const p = products.find(x => x.id == req.params.id);
    if (!p) return res.json({ ok: false, error: 'Producto no encontrado' });
    const vars = buildVariations(p);
    const precio = parseFloat((p.variants && p.variants[0] && p.variants[0].price) || 0) * 2;
    const actualizados = [];
    for (const v of vars) {
      const mlId = v.sku && mapeo[v.sku + '_' + v.color];
      if (mlId) {
        try {
          await axios.put('https://api.mercadolibre.com/items/' + mlId,
            { price: precio, available_quantity: v.stock > 0 ? v.stock : 0 },
            { headers: { 'Authorization': 'Bearer ' + mlToken, 'Content-Type': 'application/json' }}
          );
          actualizados.push(v.color);
        } catch(e) { console.log('Error actualizando:', e.message); }
      }
    }
    const nombre = (p.name && (p.name.es || p.name.en)) || 'Producto';
    agregarNotif('Actualizado en ML: ' + nombre + ' (' + actualizados.join(', ') + ')');
    res.json({ ok: true, total: actualizados.length });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/publicar/:id', async (req, res) => {
  try {
    const products = await fetchAllProducts();
    const p = products.find(x => x.id == req.params.id);
    if (!p) return res.json({ ok: false, error: 'Producto no encontrado' });
    const nombre = (p.name && (p.name.es || p.name.en)) || 'Producto';
    const cat    = detectarCategoria(nombre);
    const precio = parseFloat((p.variants && p.variants[0] && p.variants[0].price) || 0) * 2;
    const marca  = detectarMarca(nombre, p.brand);
    const vars   = buildVariations(p);
    const extraAttr = cat.tipo ? { id: cat.tipo, value_name: cat.valor } : null;
    const coloresStr = vars.map(v => v.color).join(', ');
    const tituloBase = nombre.toLowerCase().includes(marca.toLowerCase()) ? nombre : nombre + ' ' + marca; const titulo = tituloBase.slice(0, 60);
    const fallbackPictures = (p.images || []).map(img => ({ source: img.src }));
    const descTN = (p.description && (p.description.es || p.description.en)) || '';
    const links = [];
    for (const v of vars) {
      const pictures = v.imagesPorColor && v.imagesPorColor.length > 0 ? v.imagesPorColor.map(src => ({ source: src })) : fallbackPictures;
      const desc = armarDescripcion(nombre, marca, v.color, coloresStr, descTN);
      await new Promise(r => setTimeout(r, 500));
      const data = await publicarColorEnML(titulo, cat, precio, marca, v.stock, v.color, pictures, desc, extraAttr, v.sku);
      if (v.sku) { mapeo[v.sku + '_' + v.color] = data.id; guardarMapeo(); }
      links.push({ color: v.color, url: data.permalink });
    }
    agregarNotif('Publicado en ML: ' + nombre + ' (' + links.length + ' colores)');
    res.json({ ok: true, total: vars.length, links });
  } catch(e) {
    console.error('ERROR:', JSON.stringify(e.response && e.response.data));
    const msg = (e.response && e.response.data && e.response.data.cause && e.response.data.cause[0] && e.response.data.cause[0].message) || (e.response && e.response.data && e.response.data.message) || e.message;
    res.json({ ok: false, error: msg });
  }
});

const CSS = `*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}:root{--bg:#f5f5f7;--surface:#fff;--border:#d2d2d7;--text:#1d1d1f;--text2:#6e6e73;--accent:#0071e3;--accent2:#34c759;--danger:#ff3b30;--warn:#ff9500;--radius:12px;--shadow:0 2px 20px rgba(0,0,0,0.08)}body{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}.navbar{background:rgba(255,255,255,0.85);backdrop-filter:blur(20px);border-bottom:0.5px solid var(--border);padding:0 32px;height:52px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}.navbar-brand{font-size:17px;font-weight:600;letter-spacing:-0.3px}.navbar-actions{display:flex;align-items:center;gap:8px}.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:20px;font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all 0.2s;text-decoration:none}.btn-primary{background:var(--accent);color:white}.btn-primary:hover{background:#0077ed}.btn-secondary{background:var(--surface);color:var(--text);border:0.5px solid var(--border)}.btn-secondary:hover{background:var(--bg)}.btn-danger{background:var(--danger);color:white}.notif-btn{position:relative;background:none;border:none;cursor:pointer;font-size:18px;padding:4px;border-radius:8px}.notif-badge{position:absolute;top:-2px;right:-2px;background:var(--danger);color:white;border-radius:50%;width:16px;height:16px;font-size:10px;font-weight:600;display:none;align-items:center;justify-content:center}.container{max-width:1200px;margin:0 auto;padding:32px 24px}.page-header{margin-bottom:28px}.page-title{font-size:28px;font-weight:700;letter-spacing:-0.5px}.page-subtitle{font-size:14px;color:var(--text2);margin-top:4px}.tabs{display:flex;background:var(--surface);border:0.5px solid var(--border);border-radius:10px;padding:3px;margin-bottom:24px;width:fit-content}.tab{padding:6px 18px;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;color:var(--text2);transition:all 0.2s;border:none;background:none}.tab.active{background:var(--surface);box-shadow:0 1px 4px rgba(0,0,0,0.12);color:var(--text)}.toolbar{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}.search-input{background:var(--surface);border:0.5px solid var(--border);border-radius:10px;padding:8px 14px;font-size:13px;width:240px;outline:none}.search-input:focus{border-color:var(--accent)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}.card{background:var(--surface);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform 0.2s,box-shadow 0.2s;position:relative}.card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.12)}.card-img{width:100%;height:150px;object-fit:cover;display:block;background:var(--bg)}.card-img-placeholder{width:100%;height:150px;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text2);font-size:12px}.card-body{padding:12px}.card-checkbox{position:absolute;top:10px;left:10px;width:20px;height:20px;border-radius:6px;cursor:pointer;accent-color:var(--accent)}.card-title{font-size:12px;font-weight:600;color:var(--text);margin-bottom:3px;line-height:1.3}.card-brand{font-size:11px;color:var(--text2);margin-bottom:4px}.card-price{font-size:13px;font-weight:600;color:var(--accent);margin-bottom:4px}.card-stock{font-size:11px;color:var(--text2);margin-bottom:8px}.card-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;margin-bottom:6px}.badge-published{background:#d1f0db;color:#1a7a3a}.badge-unpublished{background:#fff0e0;color:#a05000}.card-links{font-size:10px;margin-bottom:6px}.card-links a{color:var(--accent);text-decoration:none;margin-right:4px}.card-status{font-size:11px;margin-top:4px;min-height:14px}.publish-btn{width:100%;padding:7px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:none;background:var(--accent);color:white;transition:background 0.2s}.publish-btn:hover{background:#0077ed}.publish-btn.gray{background:var(--surface);color:var(--text2);border:0.5px solid var(--border)}.del-btn{padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;border:none;background:var(--danger);color:white;transition:background 0.2s}.publish-btn:disabled,.del-btn:disabled{opacity:0.5;cursor:not-allowed}.empty-state{text-align:center;padding:60px 20px;color:var(--text2)}.empty-state-icon{font-size:40px;margin-bottom:12px}.empty-state-text{font-size:15px;font-weight:500}.stats-bar{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}.stat{background:var(--surface);border-radius:var(--radius);padding:16px 20px;flex:1;min-width:120px;box-shadow:var(--shadow)}.stat-number{font-size:24px;font-weight:700}.stat-label{font-size:12px;color:var(--text2);margin-top:2px}.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:200;align-items:center;justify-content:center}.modal.open{display:flex}.modal-content{background:var(--surface);border-radius:16px;padding:24px;max-width:480px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,0.2)}.notif-list{max-height:400px;overflow-y:auto}.notif-item{padding:12px;border-bottom:0.5px solid var(--border);font-size:13px}.notif-item.unread{background:#f0f8ff}.notif-fecha{font-size:11px;color:var(--text2);margin-bottom:2px}`;

function renderPage(title, content) {
  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' - Positano</title><style>' + CSS + '</style></head><body>'
    + '<nav class="navbar"><span class="navbar-brand">Positano Publisher</span><div class="navbar-actions"><a href="/productos" class="btn btn-secondary">Productos</a><a href="/sync" class="btn btn-secondary">Sync</a><button class="notif-btn" onclick="abrirNotif()">&#128276;<span class="notif-badge" id="notif-badge"></span></button></div></nav>'
    + content
    + '<div class="modal" id="modal-notif"><div class="modal-content"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:17px;font-weight:600">Notificaciones</span><button onclick="cerrarNotif()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text2)">x</button></div><div class="notif-list" id="notif-list"><p style="color:var(--text2);font-size:13px;text-align:center;padding:20px">Cargando...</p></div><button onclick="marcarLeidas()" class="btn btn-secondary" style="margin-top:12px;width:100%;justify-content:center">Marcar todas como leidas</button></div></div>'
    + '<script>async function cargarBadge(){try{const r=await fetch("/api/notificaciones");const d=await r.json();const n=d.filter(x=>!x.leida).length;const b=document.getElementById("notif-badge");if(b){b.style.display=n>0?"flex":"none";b.textContent=n;}}catch(e){}}async function abrirNotif(){document.getElementById("modal-notif").classList.add("open");const r=await fetch("/api/notificaciones");const d=await r.json();const el=document.getElementById("notif-list");el.innerHTML=d.length===0?"<p style=\'color:var(--text2);font-size:13px;text-align:center;padding:20px\'>Sin notificaciones</p>":d.map(n=>"<div class=\'notif-item "+(n.leida?"":"unread")+"\'><div class=\'notif-fecha\'>"+n.fecha+"</div>"+n.msg+"</div>").join("");await fetch("/api/notificaciones/leer",{method:"POST"});cargarBadge();}function cerrarNotif(){document.getElementById("modal-notif").classList.remove("open");}async function marcarLeidas(){await fetch("/api/notificaciones/leer",{method:"POST"});cargarBadge();cerrarNotif();}cargarBadge();setInterval(cargarBadge,30000);</script>'
    + '</body></html>';
}

app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.send('Error: no code');
    const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code: code,
      redirect_uri: 'https://future-waiver-railway-heater.trycloudflare.com/auth/callback'
    });
    mlToken = data.access_token;
    console.log('Token OAuth obtenido con permisos completos:', mlToken);
    const content = require('fs').readFileSync('C:\\positano-publisher\\index.js', 'utf8');
    const updated = content.replace(/APP_USR-7264088506318196-[^']+/, mlToken);
    require('fs').writeFileSync('C:\\positano-publisher\\index.js', updated, 'utf8');
    res.redirect('/productos');
  } catch(e) {
    console.error('Error OAuth:', e.response && e.response.data || e.message);
    res.send('Error: ' + JSON.stringify(e.response && e.response.data || e.message));
  }
});

app.get('/', (req, res) => { res.redirect('/productos'); });

app.get('/sync', (req, res) => {
  const items = logsSync.length === 0
    ? '<div class="empty-state"><div class="empty-state-icon">&#9203;</div><div class="empty-state-text">Sin actividad todavia</div><div class="empty-state-sub">La sincronizacion corre cada 5 minutos</div></div>'
    : logsSync.map(l => '<div style="background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:12px;box-shadow:var(--shadow)"><div style="font-size:12px;color:var(--text2);margin-bottom:6px">'+l.fecha+'</div>'+(l.actualizaciones.length?l.actualizaciones.map(a=>'<div style="font-size:13px">&#10003; '+a+'</div>').join(''):'<div style="font-size:13px;color:var(--text2)">Sin cambios</div>')+'</div>').join('');
  res.send(renderPage('Sync', '<div class="container"><div class="page-header"><div class="page-title">Sincronizacion de stock</div><div class="page-subtitle">Se actualiza cada 5 minutos</div></div>'+items+'</div>'));
});

app.get('/productos', async (req, res) => {
  try {
    const data = await fetchAllProducts();
    const publicados = data.filter(p => estaPublicado(buildVariations(p)));
    const noPublicados = data.filter(p => !estaPublicado(buildVariations(p)));

    function renderCard(p) {
      const nombre = (p.name && (p.name.es || p.name.en)) || 'Sin nombre';
      const marca  = detectarMarca(nombre, p.brand);
      const stock  = p.variants ? p.variants.reduce((s, v) => s + (parseInt(v.stock) || 0), 0) : 0;
      const vars   = buildVariations(p);
      const precioOrig = parseFloat((p.variants && p.variants[0] && p.variants[0].price) || 0);
      const publicado = estaPublicado(vars);
      const linksML = vars.filter(v => v.sku && mapeo[v.sku + '_' + v.color])
        .map(v => '<a href="https://articulo.mercadolibre.com.ar/' + mapeo[v.sku + '_' + v.color] + '" target="_blank">' + v.color + '</a>').join(' &middot; ');

      const btnPublicar = '<button class="publish-btn' + (publicado ? ' gray' : '') + '" id="pub-' + p.id + '" onclick="' + (publicado ? 'actualizar(' + p.id + ')' : 'publicar(' + p.id + ')') + '">' + (publicado ? 'Actualizar en ML' : 'Publicar en ML') + '</button>';
      const btnEliminar = publicado ? '<button class="del-btn" id="del-' + p.id + '" onclick="eliminar(' + p.id + ')" title="Eliminar de ML">&#128465;</button>' : '';
      const btnRow = '<div style="display:flex;gap:6px">' + btnPublicar + btnEliminar + '</div>';

      return '<div class="card">'
        + '<input type="checkbox" class="card-checkbox sel-producto" value="' + p.id + '">'
        + (p.images && p.images[0] ? '<img class="card-img" src="' + p.images[0].src + '" loading="lazy">' : '<div class="card-img-placeholder">Sin imagen</div>')
        + '<div class="card-body">'
        + '<div class="card-title">' + nombre + '</div>'
        + '<div class="card-brand">' + marca + '</div>' + (vars[0] && vars[0].sku ? '<div class="card-sku" style="font-size:10px;color:var(--text2)">SKU: ' + (vars[0] && vars[0].sku || '') + '</div>' : '')
        + '<div class="card-price">$' + (precioOrig * 2).toLocaleString('es-AR') + '</div>'
        + '<div class="card-stock" id="stock-' + p.id + '">' + stock + ' u &middot; ' + vars.length + ' color(es)</div>'
        + (publicado ? '<div class="card-badge badge-published">&#10003; En ML</div><div class="card-links">' + linksML + '</div>' : '<div class="card-badge badge-unpublished">Sin publicar</div>')
        + btnRow
        + '<div class="card-status" id="status-' + p.id + '"></div>'
        + '</div></div>';
    }

    const htmlNoPublicados = noPublicados.map(renderCard).join('') || '<div class="empty-state"><div class="empty-state-icon">&#127881;</div><div class="empty-state-text">Todos publicados</div></div>';
    const htmlPublicados = publicados.map(renderCard).join('') || '<div class="empty-state"><div class="empty-state-icon">&#128230;</div><div class="empty-state-text">Todavia no publicaste nada</div></div>';

    const content = '<div class="container">'
      + '<div class="page-header"><div class="page-title">Catalogo Positano</div><div class="page-subtitle">' + data.length + ' productos sincronizados</div></div>'
      + '<div class="stats-bar">'
      + '<div class="stat"><div class="stat-number">' + data.length + '</div><div class="stat-label">Total</div></div>'
      + '<div class="stat"><div class="stat-number" style="color:var(--accent2)">' + publicados.length + '</div><div class="stat-label">En ML</div></div>'
      + '<div class="stat"><div class="stat-number" style="color:var(--warn)">' + noPublicados.length + '</div><div class="stat-label">Sin publicar</div></div>'
      + '</div>'
      + '<div class="toolbar">'
      + '<input class="search-input" type="text" placeholder="Buscar..." oninput="filtrar(this.value)">'
      + '<button class="btn btn-primary" onclick="publicarSeleccionados()">Publicar seleccionados</button>'
      + '<button class="btn btn-secondary" onclick="seleccionarTodos()">Seleccionar todos</button>'
      + '<button class="btn btn-danger" onclick="eliminarSeleccionados()">Eliminar de ML</button>'
      + '</div>'
      + '<div class="tabs">'
      + '<button class="tab active" onclick="mostrarTab(\'sin-publicar\',this)">Sin publicar (' + noPublicados.length + ')</button>'
      + '<button class="tab" onclick="mostrarTab(\'publicados\',this)">En ML (' + publicados.length + ')</button>'
      + '</div>'
      + '<div id="sin-publicar"><div class="grid">' + htmlNoPublicados + '</div></div>'
      + '<div id="publicados" style="display:none"><div class="grid">' + htmlPublicados + '</div></div>'
      + '<script>'
      + 'function mostrarTab(id,btn){document.getElementById("sin-publicar").style.display=id==="sin-publicar"?"":"none";document.getElementById("publicados").style.display=id==="publicados"?"":"none";document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));btn.classList.add("active");}'
      + 'function filtrar(q){const cards=document.querySelectorAll(".card");q=q.toLowerCase();cards.forEach(c=>{const titulo=c.querySelector(".card-title").textContent.toLowerCase();const skuEl=c.querySelector(".card-sku");const sku=skuEl?skuEl.textContent.toLowerCase():"";c.style.display=(titulo.includes(q)||sku.includes(q))?"":"none";});}'
      + 'function seleccionarTodos(){const tabActiva=document.getElementById("sin-publicar").style.display!=="none"?"sin-publicar":"publicados";const visible=[...document.getElementById(tabActiva).querySelectorAll(".sel-producto")].filter(c=>c.closest(".card").style.display!=="none");const allChecked=visible.every(c=>c.checked);visible.forEach(c=>c.checked=!allChecked);}'
      + 'async function publicar(id){const btn=document.getElementById("pub-"+id);btn.disabled=true;btn.textContent="Publicando...";const statusEl=document.getElementById("status-"+id);try{const res=await fetch("/publicar/"+id,{method:"POST"});const data=await res.json();if(data.ok){btn.style.background="var(--accent2)";btn.textContent="Publicado!";statusEl.style.color="var(--accent2)";statusEl.textContent=data.total+" colores";setTimeout(()=>location.reload(),2000);}else{btn.disabled=false;btn.textContent="Publicar en ML";statusEl.style.color="var(--danger)";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.textContent="Error";}}'
      + 'async function eliminar(id){if(!confirm("Eliminar de Mercado Libre?"))return;const btn=document.getElementById("del-"+id);btn.disabled=true;btn.textContent="...";const statusEl=document.getElementById("status-"+id);try{const res=await fetch("/eliminar/"+id,{method:"POST"});const data=await res.json();if(data.ok){statusEl.style.color="var(--accent2)";statusEl.textContent="Eliminado";setTimeout(()=>location.reload(),1500);}else{btn.disabled=false;btn.innerHTML="&#128465;";statusEl.style.color="var(--danger)";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.innerHTML="&#128465;"}}'
      + 'async function publicarSeleccionados(){const checks=document.querySelectorAll(".sel-producto:checked");const ids=[...checks].map(c=>c.value);if(ids.length===0){alert("Selecciona al menos un producto");return;}for(const id of ids){await publicar(id);await new Promise(r=>setTimeout(r,500));}}'
      + 'async function eliminarSeleccionados(){const checks=document.querySelectorAll(".sel-producto:checked");const ids=[...checks].map(c=>c.value);if(ids.length===0){alert("Selecciona al menos un producto");return;}if(!confirm("Eliminar "+ids.length+" publicaciones de ML?"))return;for(const id of ids){await eliminar(id);await new Promise(r=>setTimeout(r,300));}}'
      + '</script></div>';

    res.send(renderPage('Productos', content));
  } catch(e) {
    res.send('<h2>Error: ' + e.message + '</h2>');
  }
});

const PORT = process.env.PORT || 3000; app.listen(PORT, '0.0.0.0', () => console.log('Corriendo en puerto ' + PORT));