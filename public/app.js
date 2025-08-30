const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function toast(msg, ms=2000){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), ms); }
async function api(path, opts={}){ const r=await fetch(path, opts); if(!r.ok) throw new Error(await r.text()); return r.json(); }
function today(){ return new Date().toISOString().slice(0,10); }
function vehicleImg(v){ return v.image_path || '/placeholder-vehicle.svg'; }
const icon = (name) => `<i class="mdi mdi-${name}"></i>`;

// EXIF orientation parsing (JPEG only) and client-side image compression
async function getExifOrientation(file){
  try{
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0, false) !== 0xFFD8) return 1; // not JPEG
    let offset = 2;
    const length = view.byteLength;
    while (offset + 4 < length){
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) { // APP1
        const size = view.getUint16(offset, false);
        const start = offset + 2;
        // Check for Exif\0\0
        if (start + 6 <= length){
          const exifId = String.fromCharCode(view.getUint8(start))+
                         String.fromCharCode(view.getUint8(start+1))+
                         String.fromCharCode(view.getUint8(start+2))+
                         String.fromCharCode(view.getUint8(start+3));
          if (exifId === 'Exif' && view.getUint8(start+4) === 0 && view.getUint8(start+5) === 0) {
            const tiff = start + 6;
            const endian = view.getUint16(tiff, false);
            const little = endian === 0x4949; // 'II'
            if (!little && endian !== 0x4D4D) return 1;
            if (view.getUint16(tiff+2, little) !== 0x002A) return 1;
            const ifd0Offset = view.getUint32(tiff+4, little);
            const ifd0 = tiff + ifd0Offset;
            const entries = view.getUint16(ifd0, little);
            for (let i=0;i<entries;i++){
              const entry = ifd0 + 2 + i*12;
              const tag = view.getUint16(entry, little);
              if (tag === 0x0112){ // Orientation
                const val = view.getUint16(entry+8, little);
                return val || 1;
              }
            }
          }
        }
        offset += size;
      } else if ((marker & 0xFF00) !== 0xFF00) {
        break;
      } else {
        const size = view.getUint16(offset, false);
        offset += size;
      }
    }
  }catch{}
  return 1;
}

function canvasToBlob(canvas, type='image/jpeg', quality=0.82){
  return new Promise((resolve)=>canvas.toBlob((b)=>resolve(b), type, quality));
}

async function processImageFile(file, {maxW=1600, maxH=1200, quality=0.82}={}){
  if (!file || !file.type.startsWith('image/')) return file;
  const orientation = await getExifOrientation(file);
  const imgUrl = URL.createObjectURL(file);
  try{
    const img = await new Promise((res, rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=imgUrl; });
    let iw = img.naturalWidth || img.width; let ih = img.naturalHeight || img.height;
    const scale = Math.min(maxW/iw, maxH/ih, 1);
    const dw = Math.round(iw * scale); const dh = Math.round(ih * scale);
    const swap = orientation>=5 && orientation<=8;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? dh : dw;
    canvas.height = swap ? dw : dh;
    const ctx = canvas.getContext('2d');
    // Transform according to EXIF orientation
    switch(orientation){
      case 2: ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break; // mirror X
      case 3: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break; // rotate 180
      case 4: ctx.translate(0, canvas.height); ctx.scale(1, -1); break; // mirror Y
      case 5: ctx.rotate(0.5*Math.PI); ctx.scale(1, -1); ctx.translate(0, -canvas.width); break; // transpose
      case 6: ctx.rotate(0.5*Math.PI); ctx.translate(0, -canvas.width); break; // rotate 90 CW
      case 7: ctx.rotate(0.5*Math.PI); ctx.translate(canvas.height, -canvas.width); ctx.scale(-1,1); break; // transverse
      case 8: ctx.rotate(-0.5*Math.PI); ctx.translate(-canvas.height, 0); break; // rotate 90 CCW
      default: break; // 1: normal
    }
    ctx.drawImage(img, 0, 0, dw, dh);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    return blob || file;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

function route(){ const p=location.hash.replace(/^#/, '').split('/').filter(Boolean); if(p.length===0) return ['home']; return p; }
function setActiveNav(){
  const p = route()[0] || 'home';
  const nav = document.querySelector('.bottom-nav');
  if(!nav) return;
  nav.querySelectorAll('.bn-item').forEach(el=>el.classList.remove('active'));
  const key = p === 'add-vehicle' ? 'add' : p;
  const selMap = { home: '[data-nav="home"]', settings: '[data-nav="settings"]', add: '[data-nav="add"]' };
  const sel = selMap[key];
  if(sel){ const el = nav.querySelector(sel); if(el) el.classList.add('active'); }
}
window.addEventListener('hashchange', render); window.addEventListener('load', render);

async function render(){ const p=route(); setActiveNav(); if(p[0]==='home') return renderHome(); if(p[0]==='settings') return renderSettings(); if(p[0]==='add-vehicle') return renderAddVehicle(); if(p[0]==='edit-vehicle') return renderEditVehicle(p[1]); if(p[0]==='vehicle'){ if(p[2]==='add-entry') return renderAddEntry(p[1]); if(p[2]==='edit-entry') return renderEditEntry(p[3], p[1]); return renderVehicle(p[1]); } return renderHome(); }

function badge(summary){
  if(!summary) return '';
  const m = summary.status==='due'?'Due Now':summary.status==='soon'?'Due Soon':'OK';
  const i = summary.status==='due'?'alert-octagon-outline': summary.status==='soon'?'clock-outline':'check-circle-outline';
  return `<span class="badge ${summary.status}">${icon(i)} ${m}</span>`;
}

function renderHomeSkeleton(){
  const app=$('#app');
  const card = () => `
    <div class="card vehicle-card">
      <div class="skel-rect"></div>
      <div class="content">
        <div class="skel-line w-60"></div>
        <div class="skel-line w-40"></div>
        <div class="chips"><span class="skel-chip"></span> <span class="skel-chip"></span> <span class="skel-chip"></span></div>
        <div class="toolbar"><span class="skel-btn"></span> <span class="skel-btn"></span></div>
      </div>
    </div>`;
  app.innerHTML = `<div class="grid">${[0,1,2].map(card).join('')}</div>`;
}

async function renderHome(){
  const app=$('#app');
  renderHomeSkeleton();
  const {vehicles}=await api('/api/vehicles?includeStats=1');
  app.innerHTML=`
  <div class="grid">${vehicles.map(v=>`
    <div class="card vehicle-card">
      <img class="image" loading="lazy" src="${vehicleImg(v)}" alt="vehicle">
      <div class="content">
        <div class="vehicle-title">${v.nickname||''}</div>
        <div class="vehicle-sub">${v.year||''} ${v.make||''} ${v.model||''}</div>
        <div class="badges">${badge(v.summary)}</div>
        <div class="chips">
          ${v.summary?.lastDate?`<span class='chip'>${icon('history')} Last: ${v.summary.lastDate}${v.summary.lastMileage?` @ ${v.summary.lastMileage} mi`:''}</span>`:''}
          ${v.summary?.nextDate?`<span class='chip'>${icon('calendar-month-outline')} Next: ${v.summary.nextDate}</span>`:''}
          ${v.summary?.nextMileage?`<span class='chip'>${icon('road-variant')} Next: ${v.summary.nextMileage} mi</span>`:''}
          <span class='chip'>${icon('gauge')} ${v.current_mileage||0} mi</span>
          <span class='chip'>${icon('timer-sand')} ${v.service_interval_miles||'-'} mi / ${v.service_interval_months||'-'} mo</span>
        </div>
        <div class="toolbar">
          <a class="btn small" href="#/vehicle/${v.id}">${icon('information-outline')} Details</a>
          <a class="btn small warn" href="#/vehicle/${v.id}/add-entry">${icon('wrench')} Add Service</a>
        </div>
      </div>
    </div>`).join('')}</div>`;
}

function field({label,name,type='text',value='',attrs=''}){ return `<div class='field'><label for='${name}'>${label}</label><input id='${name}' name='${name}' type='${type}' value='${value}' ${attrs}></div>`; }

async function renderAddVehicle(){ const app=$('#app'); app.innerHTML=`
  <div class='card section'>
    <h3>Add Vehicle</h3>
    <form id='vehForm' class='form'>
      <div class='field'>
        <label>Vehicle Photo</label>
        <img id='imagePreview' class='preview' src='/placeholder-vehicle.svg' alt='vehicle preview'>
        <div class='file-row'>
          <label for='imageCamera' class='btn small'>${icon('camera')} Camera</label>
          <label for='imageGallery' class='btn small'>${icon('image-multiple-outline')} Gallery</label>
          <input id='imageCamera' name='image' type='file' accept='image/*' capture='environment'>
          <input id='imageGallery' name='image' type='file' accept='image/*'>
        </div>
      </div>
      ${field({label:'Nickname',name:'nickname'})}
      <div class='field-row'>
        ${field({label:'Year',name:'year',type:'number',attrs:'inputmode="numeric"'})}
        ${field({label:'Make',name:'make'})}
        ${field({label:'Model',name:'model'})}
      </div>
      <div class='field-row'>
        ${field({label:'VIN',name:'vin'})}
        <button class='btn small' type='button' id='decodeBtn'>${icon('car-search-outline')} Decode VIN</button>
      </div>
      <div id='vinInfo' class='kv' style='display:none'></div>
      <div class='field-row'>
        ${field({label:'Owner First',name:'owner_first'})}
        ${field({label:'Owner Last',name:'owner_last'})}
      </div>
      ${field({label:'Current Mileage',name:'current_mileage',type:'number',attrs:'inputmode="numeric"'})}
      <div class='field-row'>
        ${field({label:'Oil Quarts',name:'oil_quarts',type:'number',attrs:'step="0.1"'})}
        ${field({label:'Oil Weight',name:'oil_weight',value:'5W-30'})}
      </div>
      <div class='field-row'>
        ${field({label:'Interval Miles',name:'service_interval_miles',type:'number',value:'5000'})}
        ${field({label:'Interval Months',name:'service_interval_months',type:'number',value:'6'})}
      </div>
      <div class='toolbar'><button class='btn primary' type='submit'>${icon('content-save-outline')} Save</button><a class='btn' href='#/'>${icon('close-circle-outline')} Cancel</a></div>
    </form>
  </div>`;
  // live photo preview (camera or gallery)
  const imgCam=$('#imageCamera'); const imgGal=$('#imageGallery'); const imgPrev=$('#imagePreview');
  function handleImgChange(e){ const input=e.currentTarget; const f=input.files?.[0]; if(f){ imgPrev.src=URL.createObjectURL(f); if(input===imgCam) imgGal.value=''; else imgCam.value=''; } }
  imgCam.addEventListener('change', handleImgChange); imgGal.addEventListener('change', handleImgChange);
  let vinData=null; $('#decodeBtn').addEventListener('click', async()=>{ const vin=$('#vin').value.trim(); if(!vin) return toast('Enter VIN'); try{ const {simplified}=await api(`/api/vin/${encodeURIComponent(vin)}`); vinData=simplified; if(simplified){ if(simplified.ModelYear) $('#year').value=simplified.ModelYear; if(simplified.Make) $('#make').value=simplified.Make; if(simplified.Model) $('#model').value=simplified.Model; const kv=$('#vinInfo'); kv.style.display='grid'; kv.innerHTML=`<div class='k'>Engine</div><div>${simplified.EngineCylinders||''} cyl ${simplified.DisplacementL? simplified.DisplacementL+'L':''}</div><div class='k'>Fuel</div><div>${simplified.FuelTypePrimary||''}</div><div class='k'>Body</div><div>${simplified.BodyClass||''}</div>`; } else toast('No VIN data'); }catch{ toast('VIN decode failed'); } });
  $('#vehForm').addEventListener('submit', async(e)=>{ e.preventDefault(); const fd=new FormData($('#vehForm')); const f=(imgCam.files?.[0]||imgGal.files?.[0]); if(f && f.type.startsWith('image/')){ const blob=await processImageFile(f,{maxW:1600,maxH:1200,quality:0.82}); fd.set('image', blob, (f.name||'vehicle')+'.jpg'); } if(vinData) fd.append('vin_decoded_json', JSON.stringify(vinData)); try{ await api('/api/vehicles',{method:'POST',body:fd}); location.hash='#/'; toast('Vehicle added'); }catch{ toast('Save failed'); } });
}

async function renderEditVehicle(id){ const {vehicle}=await api(`/api/vehicles/${id}`); const app=$('#app'); app.innerHTML=`
  <div class='card section'>
    <h3>Edit Vehicle</h3>
    <form id='vehForm' class='form'>
      <div class='field'>
        <label>Vehicle Photo</label>
        <img id='imagePreview' class='preview' src='${vehicleImg(vehicle)}' alt='vehicle'>
        <div class='file-row'>
          <label for='imageCamera' class='btn small'>${icon('camera')} Camera</label>
          <label for='imageGallery' class='btn small'>${icon('image-multiple-outline')} Gallery</label>
          <input id='imageCamera' name='image' type='file' accept='image/*' capture='environment'>
          <input id='imageGallery' name='image' type='file' accept='image/*'>
        </div>
      </div>
      ${field({label:'Nickname',name:'nickname',value:vehicle.nickname||''})}
      <div class='field-row'>
        ${field({label:'Year',name:'year',type:'number',value:vehicle.year||''})}
        ${field({label:'Make',name:'make',value:vehicle.make||''})}
        ${field({label:'Model',name:'model',value:vehicle.model||''})}
      </div>
      ${field({label:'VIN',name:'vin',value:vehicle.vin||''})}
      <div class='field-row'>
        ${field({label:'Owner First',name:'owner_first',value:vehicle.owner_first||''})}
        ${field({label:'Owner Last',name:'owner_last',value:vehicle.owner_last||''})}
      </div>
      ${field({label:'Current Mileage',name:'current_mileage',type:'number',value:vehicle.current_mileage||0})}
      <div class='field-row'>
        ${field({label:'Oil Quarts',name:'oil_quarts',type:'number',value:vehicle.oil_quarts||'',attrs:'step="0.1"'})}
        ${field({label:'Oil Weight',name:'oil_weight',value:vehicle.oil_weight||''})}
      </div>
      <div class='field-row'>
        ${field({label:'Interval Miles',name:'service_interval_miles',type:'number',value:vehicle.service_interval_miles||5000})}
        ${field({label:'Interval Months',name:'service_interval_months',type:'number',value:vehicle.service_interval_months||6})}
      </div>
      <div class='toolbar'><button class='btn primary' type='submit'>${icon('content-save-outline')} Save</button><a class='btn' href='#/vehicle/${id}'>${icon('close-circle-outline')} Cancel</a></div>
    </form>
  </div>`;
  // live preview for change photo (camera or gallery)
  const imgCam2=$('#imageCamera'); const imgGal2=$('#imageGallery'); const imgPrev=$('#imagePreview');
  function handleImgChange2(e){ const input=e.currentTarget; const f=input.files?.[0]; if(f){ imgPrev.src=URL.createObjectURL(f); if(input===imgCam2) imgGal2.value=''; else imgCam2.value=''; } }
  imgCam2.addEventListener('change', handleImgChange2); imgGal2.addEventListener('change', handleImgChange2);
  $('#vehForm').addEventListener('submit', async(e)=>{ e.preventDefault(); const fd=new FormData($('#vehForm')); const f=(imgCam2.files?.[0]||imgGal2.files?.[0]); if(f && f.type.startsWith('image/')){ const blob=await processImageFile(f,{maxW:1600,maxH:1200,quality:0.82}); fd.set('image', blob, (f.name||'vehicle')+'.jpg'); } try{ await api(`/api/vehicles/${id}`,{method:'PUT',body:fd}); location.hash=`#/vehicle/${id}`; toast('Updated'); }catch{ toast('Update failed'); } });
}

function entryRow(e){
  const rp = e.receipt_path;
  let receiptHtml = '';
  if (rp) {
    const isImg = /\.(png|jpe?g|webp|gif|bmp|heif|heic)$/i.test(rp);
    receiptHtml = isImg
      ? `<a href='${rp}' target='_blank'><img class='thumb' src='${rp}' alt='receipt'></a>`
      : `<a class='chip' href='${rp}' target='_blank'>${icon('file-pdf-box')} PDF</a>`;
  }
  // photos gallery
  let photosHtml = '';
  try {
    const photos = JSON.parse(e.photo_paths_json || '[]');
    if (Array.isArray(photos) && photos.length) {
      const thumbs = photos.slice(0, 3).map(p => `<a href='${p}' target='_blank'><img class='thumb' src='${p}' alt='photo'></a>`).join(' ');
      const more = photos.length > 3 ? `<span class='chip'>${icon('image-multiple-outline')} +${photos.length - 3} more</span>` : '';
      photosHtml = `<div class='row'><div>${thumbs} ${more}</div><div></div></div>`;
    }
  } catch {}
  return `<div class='entry'>
    <div class='row'><div>${icon('calendar-month-outline')} ${e.date} • ${icon('gauge')} ${e.mileage||'-'} mi</div><div class='sub'>${icon('oil')} ${e.oil_brand||''} ${e.oil_weight||''} • ${icon('filter-variant')} ${e.filter_brand||''} ${e.filter_part||''}</div></div>
    ${receiptHtml?`<div class='row'><div>${receiptHtml}</div><div></div></div>`:''}
    ${photosHtml}
    <div class='toolbar'><a class='btn small' href='#/vehicle/${e.vehicle_id}/edit-entry/${e.id}'>${icon('pencil-outline')} Edit</a></div>
  </div>`;
}

async function renderVehicle(id){ const app=$('#app'); renderVehicleSkeleton(); const {vehicle,summary}=await api(`/api/vehicles/${id}`); const {entries}=await api(`/api/vehicles/${id}/service-entries`);
  // Build VIN specs section from stored decoded JSON, if present
  let specsHtml='';
  try{
    const vin = JSON.parse(vehicle.vin_decoded_json || '{}');
    const rows=[];
    const add=(k,v)=>{ if(v!==undefined && v!==null && String(v).trim()!==''){ rows.push(`<div class='k'>${k}</div><div>${v}</div>`); } };
    // Compose engine string from cylinders and displacement
    const engineParts=[];
    if(vin.EngineCylinders) engineParts.push(`${vin.EngineCylinders} cyl`);
    if(vin.DisplacementL) engineParts.push(`${vin.DisplacementL}L`);
    // Rows (only if values exist)
    add('Year', vin.ModelYear);
    add('Make', vin.Make);
    add('Model', vin.Model);
    add('Trim', vin.Trim);
    add('Body', vin.BodyClass);
    add('Drive', vin.DriveType);
    add('Transmission', vin.TransmissionStyle);
    add('Engine', engineParts.join(' '));
    add('Fuel', vin.FuelTypePrimary);
    add('Plant', vin.PlantCountry);
    if(rows.length){ specsHtml = `<div class='section'><h3>Specifications</h3><div class='kv'>${rows.join('')}</div></div>`; }
  }catch{}
  app.innerHTML=`
  <div class='card vehicle-card'>
    <img class='image' loading='lazy' src='${vehicleImg(vehicle)}' alt='vehicle'>
    <div class='content'>
      <div class='vehicle-title'>${vehicle.nickname||''}</div>
      <div class='vehicle-sub'>${vehicle.year||''} ${vehicle.make||''} ${vehicle.model||''}</div>
      <div class='badges'>${badge(summary)}</div>
      <div class='chips'>
        ${summary?.nextDate?`<span class='chip'>${icon('calendar-month-outline')} Next: ${summary.nextDate}</span>`:''}
        ${summary?.nextMileage?`<span class='chip'>${icon('road-variant')} Next: ${summary.nextMileage} mi</span>`:''}
        ${summary?.lastDate?`<span class='chip'>${icon('history')} Last: ${summary.lastDate}${summary.lastMileage?` @ ${summary.lastMileage} mi`:''}</span>`:''}
        <span class='chip'>${icon('gauge')} ${vehicle.current_mileage||0} mi</span>
        <span class='chip'>${icon('oil')} ${vehicle.oil_weight||''} • ${vehicle.oil_quarts||''} qt</span>
        <span class='chip'>${icon('timer-sand')} ${vehicle.service_interval_miles||'-'} mi / ${vehicle.service_interval_months||'-'} mo</span>
      </div>
      <div class='kv'>
        <div class='k'>Owner</div><div>${vehicle.owner_first||''} ${vehicle.owner_last||''}</div>
        <div class='k'>VIN</div><div>${vehicle.vin||''}</div>
      </div>
      <div class='toolbar'>
        <a class='btn small' href='#/edit-vehicle/${id}'>${icon('pencil-outline')} Edit Vehicle</a>
        <a class='btn small warn' href='#/vehicle/${id}/add-entry'>${icon('wrench')} Add Service</a>
        <button class='btn small' id='exportPdf'>${icon('file-pdf-box')} Export PDF</button>
        <button class='btn small danger' id='delVehicle'>${icon('trash-can-outline')} Delete</button>
      </div>
    </div>
  </div>
  ${specsHtml}
  <div class='section'>
    <h3>Service History</h3>
    <div class='list'>${entries.map(entryRow).join('')||'<div class="sub">No entries yet</div>'}</div>
  </div>`;
  $('#exportPdf').addEventListener('click', ()=>exportVehiclePdf(vehicle, entries, summary));
  $('#delVehicle').addEventListener('click', async()=>{ if(!confirm('Delete vehicle and all entries?')) return; try{ await api(`/api/vehicles/${id}`,{method:'DELETE'}); location.hash='#/'; toast('Vehicle deleted'); }catch{ toast('Delete failed'); } });
}

function exportVehiclePdf(vehicle, entries, summary){
  try{
    const titleBase = (vehicle.nickname||'').trim() || `${vehicle.year||''} ${vehicle.make||''} ${vehicle.model||''}`.trim();
    const title = `Service History - ${titleBase}`.replace(/\s+/g,' ').trim();
    const vin = (()=>{ try{ return JSON.parse(vehicle.vin_decoded_json||'{}'); }catch{ return {}; } })();
    const escape = (s)=>String(s||'').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
    const fmtMiles = (n)=> (n||n===0) ? new Intl.NumberFormat().format(n) : '';

    const engineParts=[]; if(vin.EngineCylinders) engineParts.push(`${vin.EngineCylinders} cyl`); if(vin.DisplacementL) engineParts.push(`${vin.DisplacementL}L`);
    const specRows=[]; const add=(k,v)=>{ if(v!==undefined && v!==null && String(v).trim()!==''){ specRows.push(`<div class='k'>${escape(k)}</div><div>${escape(v)}</div>`); } };
    add('Year', vin.ModelYear||vehicle.year||'');
    add('Make', vin.Make||vehicle.make||'');
    add('Model', vin.Model||vehicle.model||'');
    add('Trim', vin.Trim||'');
    add('Body', vin.BodyClass||'');
    add('Drive', vin.DriveType||'');
    add('Transmission', vin.TransmissionStyle||'');
    add('Engine', engineParts.join(' '));
    add('Fuel', vin.FuelTypePrimary||'');
    add('Plant', vin.PlantCountry||'');
    const specsHtml = specRows.length ? `<h2>Specifications</h2><div class='kv'>${specRows.join('')}</div>` : '';

    const rowsHtml = (entries||[]).map(e=>{
      const oil=[e.oil_brand||'', e.oil_weight||'', (e.oil_quarts?`${e.oil_quarts} qt`:'')].filter(Boolean).join(' ');
      const filter=[e.filter_brand||'', e.filter_part||''].filter(Boolean).join(' ');
      const notes=escape(e.notes||'').replace(/\n/g,'<br>');
      return `<tr><td>${escape(e.date||'')}</td><td>${fmtMiles(e.mileage)||''}</td><td>${escape(oil)}</td><td>${escape(filter)}</td><td>${notes}</td></tr>`;
    }).join('');

    const nextInfo = summary ? `<div class='small'>Next: ${escape(summary.nextDate||'')}${summary.nextMileage?` • ${fmtMiles(summary.nextMileage)} mi`:''}</div>` : '';
    const imgTag = vehicle.image_path ? `<img class='vimg' src='${vehicle.image_path}' alt='vehicle'>` : '';

    const content = `<!doctype html><html><head><meta charset='utf-8'><title>${escape(title)}</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:24px}
.header{display:flex;gap:16px;align-items:center;margin-bottom:12px}
.vimg{width:240px;height:auto;border-radius:6px;object-fit:cover;border:1px solid #ddd}
.hmeta{flex:1}
.hmeta .title{font-size:22px;font-weight:700;margin:0}
.hmeta .sub{color:#555;margin:2px 0 0 0}
.kv{display:grid;grid-template-columns:160px 1fr;gap:6px 12px;margin:10px 0 0 0}
.kv .k{font-weight:600;color:#555}
h2{margin:18px 0 8px}
table{width:100%;border-collapse:collapse;margin-top:6px}
th,td{border:1px solid #ccc;padding:8px;font-size:13px;vertical-align:top}
th{background:#f5f5f5;text-align:left}
.small{color:#666;font-size:12px;margin-top:4px}
@media print{ body{padding:0.5in} .pagebreak{page-break-before:always} }
</style></head><body>
  <div class='header'>${imgTag}<div class='hmeta'>
    <p class='title'>${escape(title)}</p>
    <p class='sub'>Owner: ${escape([vehicle.owner_first, vehicle.owner_last].filter(Boolean).join(' '))} • VIN: ${escape(vehicle.vin||'')}</p>
    ${nextInfo}
  </div></div>
  ${specsHtml}
  <h2>Service History</h2>
  <table>
    <thead><tr><th>Date</th><th>Mileage</th><th>Oil</th><th>Filter</th><th>Notes</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan='5'>No entries</td></tr>`}</tbody>
  </table>
  <script>window.onload=()=>{try{window.print();}catch(e){}};<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    if(!w){ toast('Pop-up blocked. Allow pop-ups to export.'); return; }
    w.document.open(); w.document.write(content); w.document.close();
  }catch(err){ console.error('exportVehiclePdf error', err); toast('Export failed'); }
}

function renderVehicleSkeleton(){
  const app=$('#app');
  app.innerHTML=`
  <div class='card vehicle-card'>
    <div class='skel-rect'></div>
    <div class='content'>
      <div class='skel-line w-60'></div>
      <div class='skel-line w-40'></div>
      <div class='chips'><span class='skel-chip'></span> <span class='skel-chip'></span></div>
    </div>
  </div>
  <div class='section'>
    <h3>Service History</h3>
    <div class='list'>
      <div class='entry'><div class='row'><div class='skel-line w-60'></div><div class='skel-line w-40'></div></div></div>
      <div class='entry'><div class='row'><div class='skel-line w-60'></div><div class='skel-line w-40'></div></div></div>
    </div>
  </div>`;
}

async function renderAddEntry(vehicleId){ const {vehicle,lastService}=await api(`/api/vehicles/${vehicleId}`); const app=$('#app'); app.innerHTML=`
  <div class='card section'>
    <h3>Add Service Entry</h3>
    <form id='entryForm' class='form'>
      ${field({label:'Date',name:'date',type:'date',value:today()})}
      ${field({label:'Mileage',name:'mileage',type:'number',value:vehicle.current_mileage||''})}
      ${field({label:'Oil Brand',name:'oil_brand',value:lastService?.oil_brand||''})}
      <div class='field-row'>
        ${field({label:'Oil Weight',name:'oil_weight',value:lastService?.oil_weight||vehicle.oil_weight||''})}
        ${field({label:'Oil Quarts',name:'oil_quarts',type:'number',value:lastService?.oil_quarts||vehicle.oil_quarts||'',attrs:'step="0.1"'})}
      </div>
      <div class='field-row'>
        ${field({label:'Filter Brand',name:'filter_brand',value:lastService?.filter_brand||''})}
        ${field({label:'Filter Part #',name:'filter_part',value:lastService?.filter_part||''})}
      </div>
      <div class='field'><label for='notes'>Notes</label><textarea id='notes' name='notes'></textarea></div>
      <div class='field'>
        <label>Photos</label>
        <div class='file-row'>
          <label for='photosCam' class='btn small'>${icon('camera')} Camera</label>
          <label for='photosFile' class='btn small'>${icon('image-multiple-outline')} Gallery</label>
          <input id='photosCam' type='file' accept='image/*' capture='environment'>
          <input id='photosFile' type='file' accept='image/*' multiple>
        </div>
        <div class='thumb-grid' id='photosPreviewGrid'></div>
      </div>
      <div class='field'>
        <label>Receipt (image or PDF)</label>
        <div class='file-row'>
          <label for='receiptCam' class='btn small'>${icon('camera')} Scan (Camera)</label>
          <label for='receiptFile' class='btn small'>${icon('paperclip')} Choose</label>
          <input id='receiptCam' name='receipt' type='file' accept='image/*' capture='environment'>
          <input id='receiptFile' name='receipt' type='file' accept='image/*,application/pdf'>
        </div>
        <div class='file-row' id='receiptPreviewRow'></div>
      </div>
      <div class='toolbar'><button class='btn primary' type='submit'>${icon('content-save-outline')} Save</button><a class='btn' href='#/vehicle/${vehicleId}'>${icon('close-circle-outline')} Cancel</a></div>
    </form>
  </div>`;
  const recCam=$('#receiptCam'); const recFile=$('#receiptFile'); const recPrevRow=$('#receiptPreviewRow');
  function handleReceiptChange(e){ const input=e.currentTarget; const f=input.files?.[0]; recPrevRow.innerHTML=''; if(f){ if(f.type.startsWith('image/')){ const url=URL.createObjectURL(f); recPrevRow.innerHTML=`<img class='thumb' src='${url}' alt='receipt preview'>`; } else { recPrevRow.innerHTML=`<span class='chip'>${icon('file-pdf-box')} ${f.name||'PDF'}</span>`; } if(input===recCam) recFile.value=''; else recCam.value=''; } }
  recCam.addEventListener('change', handleReceiptChange); recFile.addEventListener('change', handleReceiptChange);
  // multi-photos add & preview
  const photosCam=$('#photosCam'); const photosFile=$('#photosFile'); const photosGrid=$('#photosPreviewGrid');
  const pendingPhotos=[]; const pendingPhotoKeys=new Set();
  function addPhotos(files){
    for(const f of Array.from(files||[])){
      if(!f || !f.type || !f.type.startsWith('image/')) continue;
      const key = `${f.name}|${f.size}|${f.lastModified||0}`;
      if(pendingPhotoKeys.has(key)) continue;
      pendingPhotoKeys.add(key);
      pendingPhotos.push(f);
      const url = URL.createObjectURL(f);
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.innerHTML = `<img class='thumb' src='${url}' alt='photo'><button type='button' class='thumb-remove' title='Remove'>&times;</button>`;
      item.querySelector('.thumb-remove').addEventListener('click', ()=>{
        URL.revokeObjectURL(url);
        const idx = pendingPhotos.indexOf(f);
        if(idx>=0){ pendingPhotos.splice(idx,1); }
        pendingPhotoKeys.delete(key);
        item.remove();
      });
      photosGrid.appendChild(item);
    }
  }
  photosCam.addEventListener('change', e=> addPhotos(e.target.files||[]));
  photosFile.addEventListener('change', e=> addPhotos(e.target.files||[]));
  // Duplicate submit handler removed; see the comprehensive handler below which also appends photos
  $('#entryForm').addEventListener('submit', async(e)=>{
    e.preventDefault();
    const form = $('#entryForm');
    const fd = new FormData(form);
    // handle receipt (replace image with compressed jpeg)
    const rf = (recCam.files?.[0]||recFile.files?.[0]);
    if(rf && rf.type.startsWith('image/')){
      const blob = await processImageFile(rf,{maxW:2000,maxH:2000,quality:0.8});
      fd.set('receipt', blob, (rf.name||'receipt')+'.jpg');
    } else if (rf) {
      // keep PDF or other allowed receipt types as-is
      fd.set('receipt', rf, rf.name || 'receipt.pdf');
    }
    // ensure no auto-added photo inputs are sent
    fd.delete('photos');
    // append processed photos
    for(let i=0;i<pendingPhotos.length;i++){
      const pf = pendingPhotos[i];
      if(!pf || !pf.type?.startsWith('image/')) continue;
      const blob = await processImageFile(pf,{maxW:2000,maxH:2000,quality:0.8});
      const base = (pf.name && pf.name.split('.').slice(0,-1).join('.')) || `photo_${i+1}`;
      fd.append('photos', blob, `${base}.jpg`);
    }
    try{
      await api(`/api/vehicles/${vehicleId}/service-entries`,{method:'POST',body:fd});
      location.hash=`#/vehicle/${vehicleId}`;
      toast('Entry added');
    }catch{
      toast('Save failed');
    }
  });
}

async function renderEditEntry(entryId, vehicleId){ const {entry}=await api(`/api/service-entries/${entryId}`); const app=$('#app');
  let existingPhotos = [];
  try { existingPhotos = JSON.parse(entry.photo_paths_json || '[]'); } catch { existingPhotos = []; }
  app.innerHTML=`
  <div class='card section'>
    <h3>Edit Service Entry</h3>
    <form id='entryForm' class='form'>
      ${field({label:'Date',name:'date',type:'date',value:entry.date})}
      ${field({label:'Mileage',name:'mileage',type:'number',value:entry.mileage||''})}
      ${field({label:'Oil Brand',name:'oil_brand',value:entry.oil_brand||''})}
      <div class='field-row'>
        ${field({label:'Oil Weight',name:'oil_weight',value:entry.oil_weight||''})}
        ${field({label:'Oil Quarts',name:'oil_quarts',type:'number',value:entry.oil_quarts||'',attrs:'step="0.1"'})}
      </div>
      <div class='field-row'>
        ${field({label:'Filter Brand',name:'filter_brand',value:entry.filter_brand||''})}
        ${field({label:'Filter Part #',name:'filter_part',value:entry.filter_part||''})}
      </div>
      <div class='field'><label for='notes'>Notes</label><textarea id='notes' name='notes'>${entry.notes||''}</textarea></div>
      <div class='field'>
        <label>Add Photos</label>
        <div class='file-row'>
          <label for='newPhotosCam' class='btn small'>${icon('camera')} Camera</label>
          <label for='newPhotosFile' class='btn small'>${icon('image-multiple-outline')} Gallery</label>
          <input id='newPhotosCam' type='file' accept='image/*' capture='environment'>
          <input id='newPhotosFile' type='file' accept='image/*' multiple>
        </div>
        <div class='thumb-grid' id='newPhotosPreviewGrid'></div>
      </div>
      ${existingPhotos.length?`<div class='field'><label>Existing Photos</label><div class='thumb-grid' id='existingPhotosGrid'>${existingPhotos.map(p=>`<div class='thumb-item'><a href='${p}' target='_blank'><img class='thumb' src='${p}' alt='photo'></a><label class='mini'><input type='checkbox' class='rm-photo' data-ph='${p}'> Remove</label></div>`).join('')}</div></div>`:''}
      <div class='field'>
        <label>Replace Receipt (image or PDF)</label>
        <div class='file-row'>
          <label for='receiptCam' class='btn small'>${icon('camera')} Scan (Camera)</label>
          <label for='receiptFile' class='btn small'>${icon('paperclip')} Choose</label>
          <input id='receiptCam' name='receipt' type='file' accept='image/*' capture='environment'>
          <input id='receiptFile' name='receipt' type='file' accept='image/*,application/pdf'>
        </div>
        <div class='file-row' id='receiptPreviewRow'></div>
      </div>
      ${entry.receipt_path?`<div class='field'><label>Current Receipt</label><div><a class='btn small' href='${entry.receipt_path}' target='_blank'>${icon('open-in-new')} Open</a> <label><input type='checkbox' id='remove_receipt' name='remove_receipt' value='true'> Remove</label></div></div>`:''}
      <div class='toolbar'><button class='btn primary' type='submit'>${icon('content-save-outline')} Save</button><a class='btn' href='#/vehicle/${entry.vehicle_id}'>${icon('close-circle-outline')} Cancel</a><button class='btn danger' id='delEntry' type='button'>${icon('trash-can-outline')} Delete</button></div>
    </form>
  </div>`;
  const recCam=$('#receiptCam'); const recFile=$('#receiptFile'); const recPrevRow=$('#receiptPreviewRow');
  function handleReceiptChange(e){ const input=e.currentTarget; const f=input.files?.[0]; recPrevRow.innerHTML=''; if(f){ if(f.type.startsWith('image/')){ const url=URL.createObjectURL(f); recPrevRow.innerHTML=`<img class='thumb' src='${url}' alt='receipt preview'>`; } else { recPrevRow.innerHTML=`<span class='chip'>${icon('file-pdf-box')} ${f.name||'PDF'}</span>`; } if(input===recCam) recFile.value=''; else recCam.value=''; } }
  recCam.addEventListener('change', handleReceiptChange); recFile.addEventListener('change', handleReceiptChange);
  // new photos add & preview
  const newPhotosCam=$('#newPhotosCam'); const newPhotosFile=$('#newPhotosFile'); const newPhotosGrid=$('#newPhotosPreviewGrid');
  const newPending=[]; const newKeys=new Set();
  function addNew(files){
    for(const f of Array.from(files||[])){
      if(!f || !f.type || !f.type.startsWith('image/')) continue;
      const key = `${f.name}|${f.size}|${f.lastModified||0}`;
      if(newKeys.has(key)) continue;
      newKeys.add(key);
      newPending.push(f);
      const url = URL.createObjectURL(f);
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.innerHTML = `<img class='thumb' src='${url}' alt='photo'><button type='button' class='thumb-remove' title='Remove'>&times;</button>`;
      item.querySelector('.thumb-remove').addEventListener('click', ()=>{
        URL.revokeObjectURL(url);
        const idx = newPending.indexOf(f);
        if(idx>=0){ newPending.splice(idx,1); }
        newKeys.delete(key);
        item.remove();
      });
      newPhotosGrid.appendChild(item);
    }
  }
  newPhotosCam.addEventListener('change', e=> addNew(e.target.files||[]));
  newPhotosFile.addEventListener('change', e=> addNew(e.target.files||[]));
  $('#entryForm').addEventListener('submit', async(e)=>{ e.preventDefault(); const fd=new FormData($('#entryForm')); if($('#remove_receipt')?.checked) fd.set('remove_receipt','true'); const f=(recCam.files?.[0]||recFile.files?.[0]); if(f && f.type.startsWith('image/')){ const blob=await processImageFile(f,{maxW:2000,maxH:2000,quality:0.8}); fd.set('receipt', blob, (f.name||'receipt')+'.jpg'); } else if(f){ fd.set('receipt', f, f.name||'receipt.pdf'); }
    // collect removals of existing photos
    const toRemove = $$('.rm-photo:checked').map(el=>el.dataset.ph).filter(Boolean);
    if(toRemove.length) fd.set('remove_photo_paths', JSON.stringify(toRemove));
    // ensure no stray 'photos' from any inputs
    fd.delete('photos');
    // append newly added photos
    for(let i=0;i<newPending.length;i++){
      const pf = newPending[i];
      if(!pf || !pf.type?.startsWith('image/')) continue;
      const blob = await processImageFile(pf,{maxW:2000,maxH:2000,quality:0.8});
      const base = (pf.name && pf.name.split('.').slice(0,-1).join('.')) || `photo_${i+1}`;
      fd.append('photos', blob, `${base}.jpg`);
    }
    try{ await api(`/api/service-entries/${entryId}`,{method:'PUT',body:fd}); location.hash=`#/vehicle/${entry.vehicle_id}`; toast('Updated'); }catch{ toast('Update failed'); }
  });
  $('#delEntry').addEventListener('click', async()=>{ if(!confirm('Delete this entry?')) return; try{ await api(`/api/service-entries/${entryId}`,{method:'DELETE'}); location.hash=`#/vehicle/${entry.vehicle_id}`; toast('Deleted'); }catch{ toast('Delete failed'); } });
}

function downloadBlob(name, data, mime='application/json'){
  let blob;
  if (data instanceof Blob) blob = data; else blob = new Blob([data], { type: mime });
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}

async function renderSettings(){ const app=$('#app'); app.innerHTML=`
  <div class='card section'>
    <h3>Settings</h3>
    <div class='toolbar' style='flex-wrap:wrap; gap:8px'>
      <button class='btn' id='backupBtn'>${icon('download-outline')} Backup (JSON)</button>
      <label class='btn'><input id='restoreFile' type='file' accept='application/json' style='display:none'> ${icon('upload-outline')} Restore (JSON)</label>
      <button class='btn' id='backupZipBtn'>${icon('archive-arrow-down-outline')} Full Backup (ZIP)</button>
      <label class='btn'><input id='restoreZip' type='file' accept='.zip,application/zip' style='display:none'> ${icon('archive-arrow-up-outline')} Restore Full (ZIP)</label>
    </div>
    <p class='sub'>
      JSON backup includes database records only. Full ZIP backup includes database and all uploaded images/PDFs.
    </p>
  </div>`;
  $('#backupBtn').addEventListener('click', async()=>{ try{ const data=await api('/api/backup'); downloadBlob(`oil-change-backup-${Date.now()}.json`, JSON.stringify(data, null, 2)); toast('Backup downloaded'); }catch{ toast('Backup failed'); } });
  $('#restoreFile').addEventListener('change', async(e)=>{ const f=e.target.files[0]; if(!f) return; try{ const text=await f.text(); const obj=JSON.parse(text); await api('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}); toast('Restore complete'); location.hash='#/'; }catch{ toast('Restore failed'); } });
  $('#backupZipBtn').addEventListener('click', async()=>{ try{ const r=await fetch('/api/backup/full'); if(!r.ok) throw new Error('status'); const blob=await r.blob(); downloadBlob(`oil-change-backup-${Date.now()}.zip`, blob, 'application/zip'); toast('Full backup downloaded'); }catch{ toast('Full backup failed'); } });
  $('#restoreZip').addEventListener('change', async(e)=>{ const f=e.target.files[0]; if(!f) return; try{ const fd=new FormData(); fd.append('file', f, f.name||'backup.zip'); const r=await fetch('/api/restore/full',{method:'POST', body:fd}); if(!r.ok) throw new Error('restore'); toast('Full restore complete'); location.hash='#/'; }catch{ toast('Full restore failed'); } });
}
