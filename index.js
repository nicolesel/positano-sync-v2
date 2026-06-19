const express = require('express');
const axios = require('axios');
const app = express();
const fs = require('fs');
const { execSync } = require('child_process');
app.use(express.json());

const STORE_ID = '4784990';
const TN_TOKEN = '2ac2da90bccc350d041d1fbaddd5f3e664f2e22f';
const ML_CLIENT_ID = '7264088506318196';
const ML_CLIENT_SECRET = 'sXlSgTEWWRGrOMHGDPg3JiMPSFSQUBAV';
const MAPEO_FILE = 'C:\\positano-publisher\\mapeo.json';
const NOTIF_FILE = 'C:\\positano-publisher\\notificaciones.json';
const TOKEN_FILE = 'C:\\positano-publisher\\token.json';

let mapeo = fs.existsSync(MAPEO_FILE) ? JSON.parse(fs.readFileSync(MAPEO_FILE, 'utf8')) : {};
let notificaciones = fs.existsSync(NOTIF_FILE) ? JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8')) : [];
let mlToken = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token : '';

function guardarToken(t) { mlToken = t; fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: t }), 'utf8'); }

function guardarMapeo() {
  fs.writeFileSync(MAPEO_FILE, JSON.stringify(mapeo, null, 2), 'utf8');
  try {
    execSync('git -C C:\\positano-publisher add mapeo.json', { stdio: 'ignore' });
    const status = execSync('git -C C:\\positano-publisher status --porcelain mapeo.json').toString();
    if (status.trim()) {
      execSync('git -C C:\\positano-publisher commit -m "actualizar mapeo" && git -C C:\\positano-publisher push', { stdio: 'ignore' });
    }
  } catch(e) {}
}

function agregarNotif(msg) {
  notificaciones.unshift({ fecha: new Date().toLocaleString('es-AR'), msg, leida: false });
  if (notificaciones.length > 100) notificaciones.pop();
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(notificaciones, null, 2), 'utf8');
}

async function renovarTokenML() {
  try {
    const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'client_credentials', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET,
    });
    guardarToken(data.access_token);
    console.log('Token ML renovado');
  } catch(e) { console.error('Error token:', e.message); }
}

const MARCAS = ['Zaphir','Trendy','Oreiro','Everlast','Discovery','Muaa','Alpine','Pierre Cardin','Bossi','Peyton','Hummer','Basilea','Miss Unique','Travel Tech','JOUP','Barbara','Amayra','Disney','Wilson','Unicross','Polo','Head'];

const CATEGORIAS = {
  'mochila':   { id:'MLA120350', tipo:'BACKPACK_TYPE', valor:'Urbana' },
  'morral':    { id:'MLA120350', tipo:'BACKPACK_TYPE', valor:'Urbana' },
  'cartera':   { id:'MLA120353', tipo:null, valor:null },
  'bandolera': { id:'MLA120353', tipo:null, valor:null },
  'bolso':     { id:'MLA432002', tipo:null, valor:null },
  'billetera': { id:'MLA417712', tipo:null, valor:null },
  'monedero':  { id:'MLA417712', tipo:null, valor:null },
  'rinonera':  { id:'MLA120353', tipo:null, valor:null },
  'valija':    { id:'MLA120354', tipo:null, valor:null },
  'paraguas':  { id:'MLA412056', tipo:null, valor:null },
  'gorra':     { id:'MLA114779', tipo:null, valor:null },
  'cinturon':  { id:'MLA412049', tipo:null, valor:null },
  'collar':    { id:'MLA457383', tipo:null, valor:null },
  'pulsera':   { id:'MLA433427', tipo:null, valor:null },
  'aro':       { id:'MLA1432',   tipo:null, valor:null },
  'vaso':      { id:'MLA430155', tipo:null, valor:null },
  'termo':     { id:'MLA47769',  tipo:null, valor:null },
  'cuaderno':  { id:'MLA1577',   tipo:null, valor:null },
  'agenda':    { id:'MLA1577',   tipo:null, valor:null },
  'set':       { id:'MLA120353', tipo:null, valor:null },
};

function detectarMarca(nombre, brand) { if(brand) return brand; const n = nombre.toLowerCase(); for(const m of MARCAS){ if(n.includes(m.toLowerCase())) return m; } return 'Generica'; }
function detectarCategoria(nombre) { const n = nombre.toLowerCase(); for(const [key,cat] of Object.entries(CATEGORIAS)){ if(n.includes(key)) return cat; } return { id:'MLA120353', tipo:null, valor:null }; }
function generarEAN() { const base = String(Date.now()).slice(-12); let sum = 0; for(let i = 0; i < 12; i++) sum += parseInt(base[i]) * (i%2===0?1:3); return base + ((10-(sum%10))%10); }

async function fetchAllProducts() {
  let all = [], page = 1;
  while(true) {
    const { data } = await axios.get('https://api.tiendanube.com/v1/'+STORE_ID+'/products?per_page=50&page='+page, { headers: { 'Authentication': 'bearer '+TN_TOKEN, 'User-Agent': 'PositanoPublisher/1.0' }});
    if(!data.length) break;
    all = all.concat(data);
    if(data.length < 50) break;
    page++;
  }
  return all.reverse().sort((a,b) => {
    const sA = a.variants ? a.variants.reduce((s,v) => s+(parseInt(v.stock)||0), 0) : 0;
    const sB = b.variants ? b.variants.reduce((s,v) => s+(parseInt(v.stock)||0), 0) : 0;
    if(sA===0 && sB>0) return 1;
    if(sB===0 && sA>0) return -1;
    return 0;
  });
}

function buildVariations(p) {
  const imageMap = {};
  for(const img of (p.images||[])) imageMap[img.id] = img.src;
  const colorMap = {};
  for(const v of p.variants) {
    const color = ((v.values&&v.values[0]&&v.values[0].es)||'Unico').trim();
    const key = color.toLowerCase();
    if(!colorMap[key]) colorMap[key] = { stock:0, imageIds:new Set(), colorName:color, sku:v.sku };
    colorMap[key].stock += parseInt(v.stock)||0;
    if(v.image_id) colorMap[key].imageIds.add(v.image_id);
  }
  return Object.values(colorMap).map(info => {
    const imgs = Array.from(info.imageIds).map(id => imageMap[id]).filter(Boolean);
    return { color:info.colorName, stock:info.stock, sku:info.sku, imageSrc:imgs[0]||(p.images&&p.images[0]&&p.images[0].src), imagesPorColor:imgs };
  });
}

function estaPublicado(vars) { return vars.some(v => v.sku && mapeo[v.sku+'_'+v.color]); }

const SIMJA_PRESENTACION = 'SIMJA - 20 anos vistiendo a la Argentina\n\nSomos una empresa mayorista con mas de 20 anos de trayectoria en el rubro de accesorios y marroquineria, ubicados en el corazon del barrio de Flores, Buenos Aires. A lo largo de estos anos nos convertimos en referentes del sector, trabajando con las mejores marcas nacionales e internacionales como Oreiro, Trendy, Zaphir, Everlast, Pierre Cardin, Muaa, Discovery y muchas mas.\n\nVendemos a todo el pais con envios rapidos y seguros. Cada producto que ofrecemos pasa por un control de calidad antes de llegar a tus manos. Trabajamos tanto con clientes minoristas como mayoristas, y nos enorgullece la confianza que miles de compradores depositan en nosotros cada dia.\n\n';

function armarDescripcion(nombre, marca, color, colores, descTN) {
  const descLimpia = descTN ? descTN.replace(/<[^>]*>/g,'').trim() : '';
  let desc = SIMJA_PRESENTACION;
  desc += nombre.toUpperCase() + '\n\n';
  if(descLimpia && descLimpia.length > 80) { desc += descLimpia + '\n\n'; }
  else { desc += nombre+' de la marca '+marca+'. Ideal para el uso diario, combina estilo y funcionalidad. Disponible en multiples colores.\n\n'; }
  desc += 'CARACTERISTICAS:\n- Marca: '+marca+'\n- Color: '+color+'\n- Disponible en: '+colores+'\n\nProducto nuevo, original. Envios a todo el pais.';
  return desc;
}

async function publicarColorEnML(titulo, cat, precio, marca, stock, color, pictures, descripcion, extraAttr, sku) {
  const attrs = [
    {id:'BRAND', value_name:marca}, {id:'MODEL', value_name:sku||titulo.slice(0,60)}, {id:'SELLER_SKU', value_name:sku||''},
    {id:'COLOR', value_name:color}, {id:'GTIN', value_name:generarEAN()},
    {id:'EMPTY_GTIN_REASON', value_id:'17055160'}, {id:'VALUE_ADDED_TAX', value_id:'48405909'}, {id:'IMPORT_DUTY', value_id:'49553239'},
  ];
  if(extraAttr) attrs.push(extraAttr);
  const body = { category_id:cat.id, price:precio, currency_id:'ARS', available_quantity:stock>0?stock:0, buying_mode:'buy_it_now', listing_type_id:'bronze', condition:'new', family_name:titulo.slice(0,60), pictures, attributes:attrs, shipping:{mode:'me2'} };
  const { data } = await axios.post('https://api.mercadolibre.com/items', body, { headers: { 'Authorization':'Bearer '+mlToken, 'Content-Type':'application/json' }});
  if(descripcion) { try { await axios.post('https://api.mercadolibre.com/items/'+data.id+'/description', {plain_text:descripcion}, { headers: { 'Authorization':'Bearer '+mlToken, 'Content-Type':'application/json' }}); } catch(e) {} }
  return data;
}

// ===== SYNC: solo TN->ML =====
let logsSync = [];
let ultimaRevision = new Date(Date.now()-24*60*60*1000).toISOString();
let stockTNCache = {};
let primeraVez = true;

async function sincronizarStock() {
  console.log('Sync...', new Date().toLocaleTimeString('es-AR'));
  try {
    const logEntry = { fecha: new Date().toLocaleString('es-AR'), actualizaciones: [] };
    logsSync.unshift(logEntry);
    if(logsSync.length > 50) logsSync.pop();

    const products = await fetchAllProducts();

    // TN -> ML
    for(const p of products) {
      for(const v of (p.variants||[])) {
        const key = p.id+'_'+v.id;
        const stockActual = parseInt(v.stock)||0;
        const stockAnterior = stockTNCache[key];
        if(!primeraVez && stockAnterior !== undefined && stockAnterior !== stockActual) {
          const color = ((v.values&&v.values[0]&&v.values[0].es)||'Unico');
          const mlId = v.sku && mapeo[v.sku+'_'+color];
          if(mlId) {
            try {
              await axios.put('https://api.mercadolibre.com/items/'+mlId, { available_quantity:stockActual }, { headers: { 'Authorization':'Bearer '+mlToken, 'Content-Type':'application/json' }});
              logEntry.actualizaciones.push('TN->ML: '+v.sku+' '+color+' '+stockAnterior+'->'+stockActual);
          agregarNotif('Stock cambiado en TN: '+v.sku+' '+color+' -> '+stockActual);
              console.log('TN->ML:', v.sku, color, stockAnterior, '->', stockActual);
            } catch(e) { console.log('Error TN->ML:', e.message); }
          }
        }
        stockTNCache[key] = stockActual;
      }
    }
    primeraVez = false;

    // Ventas ML -> TN
    const { data: ordersML } = await axios.get('https://api.mercadolibre.com/orders/search?seller=303503376&order.status=paid&order.date_created.from='+ultimaRevision, { headers: { 'Authorization':'Bearer '+mlToken }});
    for(const order of (ordersML.results||[])) {
      for(const item of order.order_items) {
        const mlId = item.item.id;
        const qty = item.quantity;
        const skuEntry = Object.entries(mapeo).find(([k,v]) => v===mlId);
        if(skuEntry) {
          const sku = skuEntry[0].split('_')[0];
          const p = products.find(x => x.variants && x.variants.some(v => v.sku===sku));
          if(p) {
            const variant = p.variants.find(v => v.sku===sku);
            if(variant) {
              const nuevoStock = Math.max(0, (parseInt(variant.stock)||0)-qty);
              await axios.put('https://api.tiendanube.com/v1/'+STORE_ID+'/products/'+p.id+'/variants/'+variant.id, { stock:nuevoStock }, { headers: { 'Authentication':'bearer '+TN_TOKEN, 'User-Agent':'PositanoPublisher/1.0' }});
              logEntry.actualizaciones.push('Venta ML: '+sku+' -> '+nuevoStock);
              agregarNotif('Venta en ML: '+sku+' x'+qty);
            }
          }
        }
      }
    }
    ultimaRevision = new Date().toISOString();
  } catch(e) { console.error('Error sync:', e.message); }
}

setInterval(renovarTokenML, 5*60*60*1000);
renovarTokenML().then(() => { sincronizarStock(); setInterval(sincronizarStock, 2*60*1000); });

// ===== ENDPOINTS =====
app.get('/api/notificaciones', (req,res) => res.json(notificaciones));
app.post('/api/notificaciones/leer', (req,res) => { notificaciones = notificaciones.map(n=>({...n,leida:true})); fs.writeFileSync(NOTIF_FILE, JSON.stringify(notificaciones,null,2), 'utf8'); res.json({ok:true}); });

app.get('/api/variantes/:id', async (req,res) => {
  try { const products = await fetchAllProducts(); const p = products.find(x => x.id==req.params.id); if(!p) return res.json({total:1}); res.json({total:buildVariations(p).length}); } catch(e) { res.json({total:1}); }
});

app.post('/eliminar/:id', async (req,res) => {
  try {
    const products = await fetchAllProducts();
    const p = products.find(x => x.id==req.params.id);
    if(!p) return res.json({ok:false, error:'No encontrado'});
    const vars = buildVariations(p);
    const eliminados = [];
    for(const v of vars) {
      const mlId = v.sku && mapeo[v.sku+'_'+v.color];
      if(mlId) {
        try { await axios.put('https://api.mercadolibre.com/items/'+mlId, {status:'closed'}, {headers:{'Authorization':'Bearer '+mlToken,'Content-Type':'application/json'}}); delete mapeo[v.sku+'_'+v.color]; eliminados.push(v.color); } catch(e) {}
      }
    }
    guardarMapeo();
    agregarNotif('Eliminado de ML: '+((p.name&&(p.name.es||p.name.en))||'Producto'));
    res.json({ok:true, eliminados});
  } catch(e) { res.json({ok:false, error:e.message}); }
});

app.post('/actualizar/:id', async (req,res) => {
  try {
    const products = await fetchAllProducts();
    const p = products.find(x => x.id==req.params.id);
    if(!p) return res.json({ok:false, error:'No encontrado'});
    const vars = buildVariations(p);
    const precio = parseFloat((p.variants&&p.variants[0]&&p.variants[0].price)||0) * 2;
    const actualizados = [];
    for(const v of vars) {
      const mlId = v.sku && mapeo[v.sku+'_'+v.color];
      if(mlId) {
        try { await axios.put('https://api.mercadolibre.com/items/'+mlId, {price:precio, available_quantity:v.stock>0?v.stock:0}, {headers:{'Authorization':'Bearer '+mlToken,'Content-Type':'application/json'}}); actualizados.push(v.color); } catch(e) {}
      }
    }
    agregarNotif('Actualizado en ML: '+((p.name&&(p.name.es||p.name.en))||'Producto')+' ('+actualizados.join(', ')+')');
    res.json({ok:true, total:actualizados.length});
  } catch(e) { res.json({ok:false, error:e.message}); }
});

app.post('/publicar/:id', async (req,res) => {
  try {
    const products = await fetchAllProducts();
    const p = products.find(x => x.id==req.params.id);
    if(!p) return res.json({ok:false, error:'No encontrado'});
    const nombre = (p.name&&(p.name.es||p.name.en))||'Producto';
    const cat = detectarCategoria(nombre);
    const precio = parseFloat((p.variants&&p.variants[0]&&p.variants[0].price)||0) * 2;
    const marca = detectarMarca(nombre, p.brand);
    const vars = buildVariations(p);
    const extraAttr = cat.tipo ? {id:cat.tipo, value_name:cat.valor} : null;
    const coloresStr = vars.map(v=>v.color).join(', ');
    const titulo = (nombre.toLowerCase().includes(marca.toLowerCase()) ? nombre : nombre+' '+marca).slice(0,60);
    const fallbackPictures = (p.images||[]).map(img=>({source:img.src}));
    const descTN = (p.description&&(p.description.es||p.description.en))||'';
    const links = [];
    for(const v of vars) {
      const pictures = v.imagesPorColor&&v.imagesPorColor.length>0 ? v.imagesPorColor.map(src=>({source:src})) : fallbackPictures;
      const desc = armarDescripcion(nombre, marca, v.color, coloresStr, descTN);
      await new Promise(r=>setTimeout(r,500));
      try {
        const data = await publicarColorEnML(titulo, cat, precio, marca, v.stock, v.color, pictures, desc, extraAttr, v.sku);
        if(v.sku) { mapeo[v.sku+'_'+v.color] = data.id; guardarMapeo(); }
        links.push({color:v.color, url:data.permalink});
      } catch(eColor) {
        const errMsg = (eColor.response&&eColor.response.data&&eColor.response.data.cause&&eColor.response.data.cause[0]&&eColor.response.data.cause[0].message)||eColor.message;
        links.push({color:v.color, url:null, error:errMsg});
        if(errMsg&&errMsg.includes('required for category')) {
          try {
            const data2 = await publicarColorEnML(titulo, {id:'MLA120353',tipo:null,valor:null}, precio, marca, v.stock, v.color, pictures, desc, null, v.sku);
            if(v.sku) { mapeo[v.sku+'_'+v.color] = data2.id; guardarMapeo(); }
            links[links.length-1] = {color:v.color, url:data2.permalink};
          } catch(e2) {}
        }
      }
    }
    const ok = links.filter(l=>!l.error).length;
    if(ok>0) agregarNotif('Publicado en ML: '+nombre+' ('+ok+'/'+links.length+' colores)');
    else agregarNotif('Error al publicar: '+nombre);
    res.json({ok:true, total:vars.length, links});
  } catch(e) { res.json({ok:false, error:(e.response&&e.response.data&&e.response.data.message)||e.message}); }
});

app.get('/auth/callback', async (req,res) => {
  try {
    const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', { grant_type:'authorization_code', client_id:ML_CLIENT_ID, client_secret:ML_CLIENT_SECRET, code:req.query.code, redirect_uri:'https://future-waiver-railway-heater.trycloudflare.com/auth/callback' });
    guardarToken(data.access_token);
    res.redirect('/productos');
  } catch(e) { res.send('Error: '+JSON.stringify(e.response&&e.response.data||e.message)); }
});

app.get('/', (req,res) => res.redirect('/productos'));

app.get('/sync', (req,res) => {
  const ultimoSync = logsSync.length>0 ? logsSync[0].fecha : 'Nunca';
  const conCambios = logsSync.filter(l=>l.actualizaciones.length>0);
  const stats = '<div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap">'
    +'<div style="background:var(--surface);border-radius:var(--radius);padding:16px 20px;box-shadow:var(--shadow);flex:1"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;text-transform:uppercase">Ultimo sync</div><div style="font-size:13px;font-weight:600">'+ultimoSync+'</div></div>'
    +'<div style="background:var(--surface);border-radius:var(--radius);padding:16px 20px;box-shadow:var(--shadow);flex:1"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;text-transform:uppercase">Con cambios</div><div style="font-size:24px;font-weight:700;color:var(--accent2)">'+conCambios.length+'</div></div>'
    +'<div style="background:var(--surface);border-radius:var(--radius);padding:16px 20px;box-shadow:var(--shadow);flex:1"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;text-transform:uppercase">Total syncs</div><div style="font-size:24px;font-weight:700;color:var(--text2)">'+logsSync.length+'</div></div>'
    +'</div>';
  const items = logsSync.length===0 ? '<div class="empty-state"><div class="empty-state-icon">&#9203;</div><div class="empty-state-text">Sin actividad</div></div>'
    : logsSync.map(l => {
        const ok = l.actualizaciones.length>0;
        return '<div style="background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:10px;box-shadow:var(--shadow);border-left:3px solid '+(ok?'var(--accent2)':'var(--border)') + '">'
          +'<div style="display:flex;justify-content:space-between;align-items:center'+(ok?';margin-bottom:10px':'')+'">'
          +'<span style="font-size:12px;color:var(--text2)">'+l.fecha+'</span>'
          +'<span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;background:'+(ok?'#d1f0db;color:#1a7a3a':'#f5f5f7;color:#6e6e73')+'">'+(ok?'&#10003; '+l.actualizaciones.length+' cambio(s)':'Sin cambios')+'</span>'
          +'</div>'
          +(ok?l.actualizaciones.map(a=>'<div style="font-size:13px;background:var(--bg);padding:8px 12px;border-radius:8px;margin-bottom:4px">&#8594; '+a+'</div>').join(''):'')
          +'</div>';
      }).join('');
  res.send(renderPage('Sync', '<div class="container"><div class="page-header"><div class="page-title">Sincronizacion</div><div class="page-subtitle">Ultima actualizacion: '+ultimoSync+'</div></div>'+stats+items+'</div>'));
});

const CSS = `*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}:root{--bg:#f5f5f7;--surface:#fff;--border:#d2d2d7;--text:#1d1d1f;--text2:#6e6e73;--accent:#0071e3;--accent2:#34c759;--danger:#ff3b30;--warn:#ff9500;--radius:12px;--shadow:0 2px 20px rgba(0,0,0,0.08)}body{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}.navbar{background:rgba(255,255,255,0.85);backdrop-filter:blur(20px);border-bottom:0.5px solid var(--border);padding:0 32px;height:52px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}.navbar-brand{font-size:17px;font-weight:600;letter-spacing:-0.3px}.navbar-actions{display:flex;align-items:center;gap:8px}.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:20px;font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all 0.2s;text-decoration:none}.btn-primary{background:var(--accent);color:white}.btn-primary:hover{background:#0077ed}.btn-secondary{background:var(--surface);color:var(--text);border:0.5px solid var(--border)}.btn-secondary:hover{background:var(--bg)}.btn-danger{background:var(--danger);color:white}.notif-btn{position:relative;background:none;border:none;cursor:pointer;font-size:18px;padding:4px;border-radius:8px}.notif-badge{position:absolute;top:-2px;right:-2px;background:var(--danger);color:white;border-radius:50%;width:16px;height:16px;font-size:10px;font-weight:600;display:none;align-items:center;justify-content:center}.container{max-width:1200px;margin:0 auto;padding:32px 24px}.page-header{margin-bottom:28px}.page-title{font-size:28px;font-weight:700;letter-spacing:-0.5px}.page-subtitle{font-size:14px;color:var(--text2);margin-top:4px}.tabs{display:flex;background:var(--surface);border:0.5px solid var(--border);border-radius:10px;padding:3px;margin-bottom:24px;width:fit-content}.tab{padding:6px 18px;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;color:var(--text2);transition:all 0.2s;border:none;background:none}.tab.active{background:var(--surface);box-shadow:0 1px 4px rgba(0,0,0,0.12);color:var(--text)}.toolbar{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}.search-input{background:var(--surface);border:0.5px solid var(--border);border-radius:10px;padding:8px 14px;font-size:13px;width:240px;outline:none}.search-input:focus{border-color:var(--accent)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}.card{background:var(--surface);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform 0.2s,box-shadow 0.2s;position:relative}.card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.12)}.card-img{width:100%;height:150px;object-fit:cover;display:block;background:var(--bg)}.card-img-placeholder{width:100%;height:150px;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text2);font-size:12px}.card-body{padding:12px}.card-checkbox{position:absolute;top:10px;left:10px;width:20px;height:20px;border-radius:6px;cursor:pointer;accent-color:var(--accent)}.card-title{font-size:12px;font-weight:600;color:var(--text);margin-bottom:3px;line-height:1.3}.card-brand{font-size:11px;color:var(--text2);margin-bottom:4px}.card-price{font-size:13px;font-weight:600;color:var(--accent);margin-bottom:4px}.card-stock{font-size:11px;color:var(--text2);margin-bottom:8px}.card-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;margin-bottom:6px}.badge-published{background:#d1f0db;color:#1a7a3a}.badge-unpublished{background:#fff0e0;color:#a05000}.card-links{font-size:10px;margin-bottom:6px}.card-links a{color:var(--accent);text-decoration:none;margin-right:4px}.card-status{font-size:11px;margin-top:4px;min-height:16px}.publish-btn{width:100%;padding:7px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:none;background:var(--accent);color:white;transition:background 0.2s}.publish-btn:hover{background:#0077ed}.publish-btn.gray{background:var(--surface);color:var(--text2);border:0.5px solid var(--border)}.del-btn{padding:7px 10px;border-radius:8px;font-size:12px;cursor:pointer;border:none;background:var(--danger);color:white}.publish-btn:disabled,.del-btn:disabled{opacity:0.5;cursor:not-allowed}.empty-state{text-align:center;padding:60px 20px;color:var(--text2)}.empty-state-icon{font-size:40px;margin-bottom:12px}.empty-state-text{font-size:15px;font-weight:500}.stats-bar{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}.stat{background:var(--surface);border-radius:var(--radius);padding:16px 20px;flex:1;min-width:120px;box-shadow:var(--shadow)}.stat-number{font-size:24px;font-weight:700}.stat-label{font-size:12px;color:var(--text2);margin-top:2px}.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:200;align-items:center;justify-content:center}.modal.open{display:flex}.modal-content{background:var(--surface);border-radius:16px;padding:24px;max-width:480px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,0.2)}.notif-list{max-height:400px;overflow-y:auto}.notif-item{padding:12px;border-bottom:0.5px solid var(--border);font-size:13px}.notif-item.unread{background:#f0f8ff}.notif-fecha{font-size:11px;color:var(--text2);margin-bottom:2px}`;

function renderPage(title, content) {
  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' - Positano</title><style>'+CSS+'</style></head><body>'
    +'<nav class="navbar"><span class="navbar-brand">Positano Publisher</span><div class="navbar-actions"><a href="/productos" class="btn btn-secondary">Productos</a><a href="/sync" class="btn btn-secondary">Sync</a><button class="notif-btn" onclick="abrirNotif()">&#128276;<span class="notif-badge" id="notif-badge"></span></button></div></nav>'
    +content
    +'<div class="modal" id="modal-notif"><div class="modal-content"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:17px;font-weight:600">Notificaciones</span><button onclick="cerrarNotif()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text2)">x</button></div><div class="notif-list" id="notif-list"><p style="color:var(--text2);font-size:13px;text-align:center;padding:20px">Cargando...</p></div><button onclick="marcarLeidas()" class="btn btn-secondary" style="margin-top:12px;width:100%;justify-content:center">Marcar todas como leidas</button></div></div>'
    +'<script>async function cargarBadge(){try{const r=await fetch("/api/notificaciones");const d=await r.json();const n=d.filter(x=>!x.leida).length;const b=document.getElementById("notif-badge");if(b){b.style.display=n>0?"flex":"none";b.textContent=n;}}catch(e){}}async function abrirNotif(){document.getElementById("modal-notif").classList.add("open");const r=await fetch("/api/notificaciones");const d=await r.json();const el=document.getElementById("notif-list");el.innerHTML=d.length===0?"<p style=\'color:var(--text2);font-size:13px;text-align:center;padding:20px\'>Sin notificaciones</p>":d.map(n=>"<div class=\'notif-item "+(n.leida?"":"unread")+"\'><div class=\'notif-fecha\'>"+n.fecha+"</div>"+n.msg+"</div>").join("");await fetch("/api/notificaciones/leer",{method:"POST"});cargarBadge();}function cerrarNotif(){document.getElementById("modal-notif").classList.remove("open");}async function marcarLeidas(){await fetch("/api/notificaciones/leer",{method:"POST"});cargarBadge();cerrarNotif();}cargarBadge();setInterval(cargarBadge,30000);</script>'
    +'</body></html>';
}

app.get('/productos', async (req,res) => {
  try {
    const data = await fetchAllProducts();
    const publicados = data.filter(p => estaPublicado(buildVariations(p)));
    const noPublicados = data.filter(p => !estaPublicado(buildVariations(p)));

    function renderCard(p) {
      const nombre = (p.name&&(p.name.es||p.name.en))||'Sin nombre';
      const marca = detectarMarca(nombre, p.brand);
      const stock = p.variants ? p.variants.reduce((s,v)=>s+(parseInt(v.stock)||0),0) : 0;
      const vars = buildVariations(p);
      const precioOrig = parseFloat((p.variants&&p.variants[0]&&p.variants[0].price)||0);
      const publicado = estaPublicado(vars);
      const linksML = vars.filter(v=>v.sku&&mapeo[v.sku+'_'+v.color]).map(v=>'<a href="https://articulo.mercadolibre.com.ar/'+mapeo[v.sku+'_'+v.color]+'" target="_blank">'+v.color+'</a>').join(' &middot; ');
      const btnPublicar = '<button class="publish-btn'+(publicado?' gray':'')+'" id="pub-'+p.id+'" onclick="'+(publicado?'actualizar('+p.id+')':'publicar('+p.id+')')+'">'+(publicado?'Actualizar en ML':'Publicar en ML')+'</button>';
      const btnEliminar = publicado ? '<button class="del-btn" id="del-'+p.id+'" onclick="eliminar('+p.id+')" title="Eliminar">&#128465;</button>' : '';
      return '<div class="card">'
        +'<input type="checkbox" class="card-checkbox sel-producto" value="'+p.id+'">'
        +(p.images&&p.images[0]?'<img class="card-img" src="'+p.images[0].src+'" loading="lazy">':'<div class="card-img-placeholder">Sin imagen</div>')
        +'<div class="card-body">'
        +'<div class="card-title">'+nombre+'</div>'
        +'<div class="card-brand">'+marca+'</div>'
        +(vars[0]&&vars[0].sku?'<div class="card-sku" style="font-size:10px;color:var(--text2)">SKU: '+vars[0].sku+'</div>':'')
        +'<div class="card-price">$'+(precioOrig*2).toLocaleString('es-AR')+'</div>'
        +'<div class="card-stock" id="stock-'+p.id+'">'+stock+' u &middot; '+vars.length+' color(es)</div>'
        +(publicado?'<div class="card-badge badge-published">&#10003; En ML</div><div class="card-links">'+linksML+'</div>':'<div class="card-badge badge-unpublished">Sin publicar</div>')
        +'<div style="display:flex;gap:6px">'+btnPublicar+btnEliminar+'</div>'
        +'<div class="card-status" id="status-'+p.id+'"></div>'
        +'</div></div>';
    }

    const htmlNoPublicados = noPublicados.map(renderCard).join('') || '<div class="empty-state"><div class="empty-state-icon">&#127881;</div><div class="empty-state-text">Todos publicados</div></div>';
    const htmlPublicados = publicados.map(renderCard).join('') || '<div class="empty-state"><div class="empty-state-icon">&#128230;</div><div class="empty-state-text">Todavia no publicaste nada</div></div>';

    const JS = "var publicandoMasivo=false;function mostrarTab(id,btn){document.getElementById(\"sin-publicar\").style.display=id===\"sin-publicar\"?\"\":\"none\";document.getElementById(\"publicados\").style.display=id===\"publicados\"?\"\":\"none\";document.querySelectorAll(\".tab\").forEach(t=>t.classList.remove(\"active\"));btn.classList.add(\"active\");}function filtrar(q){const cards=document.querySelectorAll(\".card\");q=q.toLowerCase();cards.forEach(c=>{const titulo=c.querySelector(\".card-title\").textContent.toLowerCase();const skuEl=c.querySelector(\".card-sku\");const sku=skuEl?skuEl.textContent.toLowerCase():\"\";c.style.display=(titulo.includes(q)||sku.includes(q))?\"\":\"none\";});}function seleccionarTodos(){const tabActiva=document.getElementById(\"sin-publicar\").style.display!==\"none\"?\"sin-publicar\":\"publicados\";const visible=[...document.getElementById(tabActiva).querySelectorAll(\".sel-producto\")].filter(c=>c.closest(\".card\").style.display!==\"none\");const allChecked=visible.every(c=>c.checked);visible.forEach(c=>c.checked=!allChecked);}function mostrarToast(msg,bg){let t=document.getElementById(\"tp\");if(!t){t=document.createElement(\"div\");t.id=\"tp\";t.style.cssText=\"position:fixed;bottom:24px;right:24px;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);min-width:220px;color:white\";document.body.appendChild(t);}t.style.background=bg||\"#1d1d1f\";t.textContent=msg;}async function publicar(id){const btn=document.getElementById(\"pub-\"+id);const statusEl=document.getElementById(\"status-\"+id);btn.disabled=true;try{const v0=await fetch(\"/api/variantes/\"+id).then(r=>r.json());btn.textContent=\"Subiendo... 0/\"+(v0.total||1);const data=await fetch(\"/publicar/\"+id,{method:\"POST\"}).then(r=>r.json());if(data.ok){const ok=data.links.filter(l=>!l.error);const fail=data.links.filter(l=>l.error);btn.style.background=\"var(--accent2)\";btn.textContent=\"Publicado! (\"+ok.length+\"/\"+data.links.length+\")\";statusEl.style.color=\"var(--accent2)\";statusEl.innerHTML=ok.map(l=>\"<a href='\"+l.url+\"' target='_blank'>\"+l.color+\"</a>\").join(\" | \")+(fail.length>0?\"<br><span style='color:red'>No se pudo: \"+fail.map(l=>l.color).join(\", \")+\"</span>\":\"\");if(!publicandoMasivo)setTimeout(()=>location.reload(),3000);}else{btn.disabled=false;btn.textContent=\"Publicar en ML\";statusEl.style.color=\"var(--danger)\";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.textContent=\"Error\";}}async function actualizar(id){const btn=document.getElementById(\"pub-\"+id);btn.disabled=true;btn.textContent=\"Actualizando...\";try{const data=await fetch(\"/actualizar/\"+id,{method:\"POST\"}).then(r=>r.json());btn.disabled=false;btn.textContent=\"Actualizar en ML\";const statusEl=document.getElementById(\"status-\"+id);if(data.ok){statusEl.style.color=\"var(--accent2)\";statusEl.textContent=\"Actualizado!\";}else{statusEl.style.color=\"var(--danger)\";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.textContent=\"Actualizar en ML\";}}async function eliminar(id){if(!confirm(\"Eliminar de Mercado Libre?\"))return;const btn=document.getElementById(\"del-\"+id);btn.disabled=true;btn.textContent=\"...\";const statusEl=document.getElementById(\"status-\"+id);try{const data=await fetch(\"/eliminar/\"+id,{method:\"POST\"}).then(r=>r.json());if(data.ok){statusEl.style.color=\"var(--accent2)\";statusEl.textContent=\"Eliminado\";setTimeout(()=>location.reload(),1500);}else{btn.disabled=false;btn.innerHTML=\"&#128465;\";statusEl.style.color=\"var(--danger)\";statusEl.textContent=data.error;}}catch(e){btn.disabled=false;btn.innerHTML=\"&#128465;\";}}async function eliminarSeleccionados(){const ids=[...document.querySelectorAll(\".sel-producto:checked\")].map(c=>c.value);if(!ids.length){alert(\"Selecciona al menos un producto\");return;}if(!confirm(\"Eliminar \"+ids.length+\" publicaciones de ML?\"))return;for(const id of ids){await eliminar(id);await new Promise(r=>setTimeout(r,300));}}async function publicarSeleccionados(){publicandoMasivo=true;const ids=[...document.querySelectorAll(\".sel-producto:checked\")].map(c=>c.value);if(!ids.length){alert(\"Selecciona al menos un producto\");publicandoMasivo=false;return;}const resultados=[];for(let i=0;i<ids.length;i++){mostrarToast(\"Subiendo \"+(i+1)+\"/\"+ids.length+\" articulos...\");const card=document.querySelector(\".card input[value='\"+ids[i]+\"']\");const nombre=card?card.closest(\".card\").querySelector(\".card-title\").textContent:\"Articulo \"+ids[i];try{const data=await fetch(\"/publicar/\"+ids[i],{method:\"POST\"}).then(r=>r.json());if(data.ok){resultados.push({nombre,ok:data.links.filter(l=>!l.error).length,errores:data.links.filter(l=>l.error).map(l=>l.error)});}else{resultados.push({nombre,ok:0,errores:[data.error]});}}catch(e){resultados.push({nombre,ok:0,errores:[e.message]});}await new Promise(r=>setTimeout(r,500));}publicandoMasivo=false;const tp=document.getElementById(\"tp\");if(tp)tp.remove();const okL=resultados.filter(r=>r.ok>0);const failL=resultados.filter(r=>r.ok===0);const m=document.createElement(\"div\");m.style.cssText=\"position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center\";const inner=document.createElement(\"div\");inner.style.cssText=\"background:white;border-radius:16px;padding:28px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto\";let html=\"<h3 style='font-size:17px;font-weight:600;margin-bottom:16px'>Resumen</h3>\";if(okL.length){html+=\"<p style='font-size:12px;color:gray;margin-bottom:6px'>PUBLICADOS (\"+okL.length+\")</p>\"+okL.map(r=>\"<p style='font-size:13px;padding:6px 0;border-bottom:1px solid #eee'>\"+r.nombre+\"</p>\").join(\"\");}if(failL.length){html+=\"<p style='font-size:12px;color:gray;margin:12px 0 6px'>NO SE PUDO (\"+failL.length+\")</p>\"+failL.map(r=>\"<p style='font-size:13px;padding:6px 0;color:red'>\"+r.nombre+(r.errores[0]?\" - \"+r.errores[0]:\"\")+\"</p>\").join(\"\");}html+=\"<button id='btnAceptar' style='width:100%;padding:10px;background:#0071e3;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-top:16px'>Aceptar</button>\";inner.innerHTML=html;m.appendChild(inner);document.body.appendChild(m);document.getElementById(\"btnAceptar\").onclick=function(){m.remove();location.reload();};}";

    const content = '<div class="container">'
      +'<div class="page-header"><div class="page-title">Catalogo Positano</div><div class="page-subtitle">'+data.length+' productos</div></div>'
      +'<div class="stats-bar"><div class="stat"><div class="stat-number">'+data.length+'</div><div class="stat-label">Total</div></div><div class="stat"><div class="stat-number" style="color:var(--accent2)">'+publicados.length+'</div><div class="stat-label">En ML</div></div><div class="stat"><div class="stat-number" style="color:var(--warn)">'+noPublicados.length+'</div><div class="stat-label">Sin publicar</div></div></div>'
      +'<div class="toolbar"><input class="search-input" type="text" placeholder="Buscar..." oninput="filtrar(this.value)"><button class="btn btn-primary" onclick="publicarSeleccionados()">Publicar seleccionados</button><button class="btn btn-secondary" onclick="seleccionarTodos()">Seleccionar todos</button><button class="btn btn-danger" onclick="eliminarSeleccionados()">Eliminar de ML</button></div>'
      +'<div class="tabs"><button class="tab active" onclick="mostrarTab(\'sin-publicar\',this)">Sin publicar ('+noPublicados.length+')</button><button class="tab" onclick="mostrarTab(\'publicados\',this)">En ML ('+publicados.length+')</button></div>'
      +'<div id="sin-publicar"><div class="grid">'+htmlNoPublicados+'</div></div>'
      +'<div id="publicados" style="display:none"><div class="grid">'+htmlPublicados+'</div></div>'
      +'<script>'+JS+'</script></div>';

    res.send(renderPage('Productos', content));
  } catch(e) { res.send('<h2>Error: '+e.message+'</h2>'); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Corriendo en http://localhost:'+PORT));