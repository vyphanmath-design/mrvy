/* TOÁN MR VY - Import TKB từ ảnh, chạy hoàn toàn trong trình duyệt.
 * Độc lập với học phí, điểm danh và API. Chỉ áp dụng 5 cột Thứ 2–6, 9 tiết trường.
 * OCR Tesseract.js chạy trong Web Worker, không gửi ảnh tới dịch vụ AI.
 */
(function () {
  'use strict';
  var state = { job: 0, worker: null, grid: null, canvas: null, cells: [], imageUrl: null, applied: false };
  var E = function(id) { return document.getElementById(id); };
  var esc = function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  function status(s, bad) { var el=E('tkbOcrStatus'); if(el){el.textContent=s; el.style.color=bad?'#b91c1c':'#334155';} }
  function progress(p) { var el=E('tkbOcrProgress'); if(el)el.value=Math.max(0, Math.min(100, p)); }
  function dis(on) { ['tkbOcrScan','tkbOcrApply','tkbOcrSave'].forEach(function(id){var b=E(id);if(b)b.disabled=!!on;}); }
  function warn(msg) { var el=E('tkbOcrWarnings');if(el){el.textContent=msg;el.hidden=!msg;} }
  function show() { E('tkbOcrModal').classList.remove('hidden');E('tkbOcrModal').style.display='flex'; }
  function hide() { E('tkbOcrModal').classList.add('hidden');E('tkbOcrModal').style.display='none'; }
  async function stop() { state.job++;if(state.worker){var old=state.worker;state.worker=null;try{await old.terminate();}catch(e){}} dis(false); }
  window.mrvyOpenTkbOcr=function(){ show(); };
  window.mrvyCloseTkbOcr=function(){stop();hide();};
  function loadScript(url) { return new Promise(function(resolve,reject) {
    if(window.Tesseract){resolve();return;}
    var s=document.createElement('script');s.src=url;s.async=true;s.onload=resolve;s.onerror=function(){reject(new Error('Không tải được Tesseract.js. Kiểm tra Internet hoặc bộ chặn CDN.'));};document.head.appendChild(s);
  }); }
  function cluster(points, minGap) { var out=[];points.forEach(function(a){if(!out.length||a-out[out.length-1][out[out.length-1].length-1]>minGap)out.push([a]);else out[out.length-1].push(a);});return out.map(function(xs){return Math.round(xs.reduce(function(x,y){return x+y;},0)/xs.length);}); }
  // Phát hiện đường kẻ từ màu sắc thực tế (không dùng tọa độ cắt cố định).
  function projections(canvas) {
    var ctx=canvas.getContext('2d',{willReadFrequently:true}), w=canvas.width,h=canvas.height;
    var img=ctx.getImageData(0,0,w,h).data;
    function px(x,y){var i=(y*w+x)*4;return [img[i],img[i+1],img[i+2]];}
    function isLine(a){var max=Math.max(a[0],a[1],a[2]), min=Math.min(a[0],a[1],a[2]);return max-min<20 && min>155 && max<250;}
    var vertical=[],horizontal=[];
    for(var x=1;x<w-1;x++){
      var n=0, total=0;
      for(var y=Math.floor(h*.13);y<Math.floor(h*.95);y+=3){total++;var a=px(x,y);if(isLine(a)&&!isLine(px(Math.min(w-1,x+4),y)))n++;}
      if(n/total>.13)vertical.push(x);
    }
    for(var y=1;y<h-1;y++){
      var n=0,total=0;
      for(var x=Math.floor(w*.08);x<Math.floor(w*.96);x+=3){total++;var a=px(x,y);if(isLine(a)&&!isLine(px(x,Math.min(h-1,y+4))))n++;}
      if(n/total>.23)horizontal.push(y);
    }
    return {x:cluster(vertical,3),y:cluster(horizontal,3)};
  }
  function linesFromWords(words) {
    var parts=[];
    words.sort(function(a,b){var ya=(a.bbox.y0+a.bbox.y1)/2,yb=(b.bbox.y0+b.bbox.y1)/2;return ya-yb || a.bbox.x0-b.bbox.x0;});
    words.forEach(function(w){var y=(w.bbox.y0+w.bbox.y1)/2, line=parts.find(function(g){return Math.abs(g.y-y)<Math.max(7,(w.bbox.y1-w.bbox.y0)*.5);});
      if(!line){line={y:y,words:[]};parts.push(line);}line.words.push(w);
    });
    return parts.sort(function(a,b){return a.y-b.y;}).map(function(l){return l.words.sort(function(a,b){return a.bbox.x0-b.bbox.x0;}).map(function(w){return w.text;}).join(' ').trim();}).filter(Boolean);
  }
  function normalizeClass(text){
    var lines=String(text||'').normalize('NFC').replace(/[|]/g,' ').split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
    var one=lines.join(' ').replace(/\s+/g,' ').trim();
    var match=one.match(/(?:^|\s)(\d{1,2})\s*([a-zA-Z])\s*(\d{1,2})(?=\s|$)/);
    var cls=match?(match[1]+match[2].toLowerCase()+match[3]):'';
    var note=/\b(?:trải\s*nghiệm|trai\s*nghiem|hđtn|hdtn|tn)\b/i.test(one)?'tn':'';
    var ambiguous=!cls && one.length>0;
    if(cls && !/^(?:[6-9]|1[012])[a-z]\d{1,2}$/i.test(cls)) ambiguous=true;
    // Ghi chú khác ngoài trải nghiệm KHÔNG tự suy đoán thành phân môn.
    return {text:cls?(cls+(note?'\ntn':'')):'', uncertain:ambiguous, raw:one};
  }
  function mockDetector(canvas, wordData) {
    var w=canvas.width,h=canvas.height;
    var p=projections(canvas);
    // Xác định 6 biên của 5 cột học bằng khoảng cách lặp của các đường dọc thực tế.
    var xs=p.x.filter(function(x){return x>w*.05&&x<w*.99;});
    var best=null;
    for(var i=0;i<xs.length;i++)for(var j=i+1;j<xs.length;j++){
      // Bỏ cột đầu ghi giờ/tiết; 5 cột ngày bắt đầu sau cột nhãn.
      if(xs[i]<w*.1)continue;
      var step=xs[j]-xs[i]; if(step<w*.075 || step>w*.3)continue;
      var track=[xs[i]]; var err=0, missingRightEdge=false;
      for(var k=1;k<=5;k++){
        var target=xs[i]+k*step;
        var hit=xs.reduce(function(b,a){return Math.abs(a-target)<Math.abs(b-target)?a:b;},xs[0]);
        if(Math.abs(hit-target)>Math.max(5,step*.09)){
          // Nếu ảnh chỉ thiếu vài pixel viền cuối, dùng mép ảnh làm biên
          // và bắt buộc cảnh báo để người dùng kiểm tra cột Thứ 6.
          if(k===5 && Math.abs((w-1)-target)<step*.065){hit=w-1;missingRightEdge=true;}
          else{track=null;break;}
        }
        track.push(hit);err+=Math.abs(hit-target);
      }
      if(track && (!best||err<best.err))best={xs:track,err:err,missingRightEdge:missingRightEdge};
    }
    // Nếu mép phải bị cắt, không đoán cột còn thiếu.
    if(!best)throw new Error('Không nhận ra đầy đủ đường kẻ của 5 cột Thứ 2–Thứ 6 hoặc ảnh bị cắt. Hãy dùng ảnh chụp trọn bảng, thẳng và rõ hơn.');
    var bounds=best.xs;
    var ys=p.y.filter(function(y){return y>h*.05&&y<h*.985;});
    // Mỗi tiết trong ảnh phải có đường kẻ trên và dưới. Lựa chọn 9 dải có độ cao gần nhau.
    var stepY=0;var gaps=[];
    for(var a=1;a<ys.length;a++){var dy=ys[a]-ys[a-1];if(dy>h*.035&&dy<h*.19)gaps.push(dy);}
    gaps.sort(function(a,b){return a-b;});if(gaps.length<7)throw new Error('Không tìm đủ đường kẻ của các tiết. Ảnh cần có đầy đủ 5 tiết sáng và 4 tiết chiều.');
    stepY=gaps[Math.floor(gaps.length/2)];
    var candidate=[];
    for(var z=1;z<ys.length;z++){
      var d=ys[z]-ys[z-1];
      if(d>=stepY*.65&&d<=stepY*1.5 && ys[z-1]>h*.1)candidate.push({a:ys[z-1],b:ys[z],d:d});
    }
    // Loại bỏ dải tiêu đề theo vị trí / độ cao; ưu tiên dải có chữ lớp dạng 10a14.
    var ctx=canvas.getContext('2d',{willReadFrequently:true});
    var cells=[];
    candidate.forEach(function(row){
      // Phần tiêu đề BUỔI CHIỀU là dải màu chạy ngang, KHÔNG có vách ô.
      // Loại bỏ dải này thay vì tính nhầm thành một tiết học.
      var midY=Math.floor((row.a+row.b)/2), midX=Math.min(w-1,Math.max(0,Math.floor((bounds[1]+bounds[2])/2)));
      var mid=ctx.getImageData(midX,midY,1,1).data;
      var isGroupBand=(mid[0]>220 && mid[1]>180 && mid[2]<210) || (mid[0]<220 && mid[1]>210 && mid[2]>220);
      if(isGroupBand)return;
      var hasClass=(wordData||[]).some(function(t){var y=(t.bbox.y0+t.bbox.y1)/2;return y>row.a+2&&y<row.b-2&&t.bbox.x0>=bounds[0]&&/\d{1,2}[a-zA-Z]\d{1,2}/.test(t.text||'');});
      cells.push({a:row.a,b:row.b, hasClass:hasClass});
    });
    if(cells.length<9)throw new Error('Ảnh không đủ 9 hàng tiết (5 sáng, 4 chiều), hoặc bảng có ô gộp chưa nhận diện được.');
    var bestNine=null;
    for(var n=0;n<=cells.length-9;n++){
      var slice=cells.slice(n,n+9);
      var score=slice.reduce(function(t,r){return t + (r.hasClass?5:0);},0);
      for(var q=1;q<slice.length;q++){var gap=slice[q].a-slice[q-1].b; if(gap>stepY*1.5)score-=5;}
      if(!bestNine || score>bestNine.score)bestNine={rows:slice,score:score};
    }
    if(!bestNine || bestNine.score<5) throw new Error('Không xác định được vùng 9 tiết của bảng trường; không áp dụng để tránh điền sai lịch.');
    return {xs:bounds, rows:bestNine.rows, ySep:bestNine.rows[4].b, missingRightEdge:best.missingRightEdge};
  }
  function pickText(allWords, left,right,top,bottom){
    return allWords.filter(function(word){var b=word.bbox,x=(b.x0+b.x1)/2,y=(b.y0+b.y1)/2;return x>left+3&&x<right-3&&y>top+2&&y<bottom-2;});
  }
  function drawPreview() {
    var html='<table class="w-full border-collapse text-center text-xs"><thead><tr class="bg-slate-900 text-white"><th class="p-1 border">Tiết</th>';
    ['Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6'].forEach(function(x){html+='<th class="p-1 border">'+x+'</th>';});html+='</tr></thead><tbody>';
    for(var r=0;r<9;r++){
      if(r===5)html+='<tr><td colspan="6" class="bg-amber-50 font-bold p-1">BUỔI CHIỀU</td></tr>';
      html+='<tr><th class="border p-1 bg-slate-50">'+(r<5?'S':'C')+(r<5?r+1:r-4)+'</th>';
      for(var c=0;c<5;c++){var cell=state.cells[r*5+c],v=cell.text, uncertain=cell.uncertain;
        html+='<td class="border p-1 '+(uncertain?'bg-amber-100':'bg-white')+'"><textarea rows="2" data-ocr-r="'+r+'" data-ocr-c="'+c+'" class="tkb-ocr-edit w-full min-w-[72px] rounded border border-slate-200 p-1 text-center font-bold text-blue-700" aria-label="'+(r+1)+' thứ '+(c+2)+'" title="OCR gốc: '+esc(cell.raw)+'">'+esc(v)+'</textarea>'+(uncertain?'<small class="text-amber-800">Kiểm tra</small>':'')+'</td>';
      }html+='</tr>';
    }html+='</tbody></table>';
    E('tkbOcrTable').innerHTML=html;
  }
  function highlight(r,c) {var ctx=E('tkbOcrImage').getContext('2d'),canvas=state.canvas, g=state.grid;if(!canvas||!g)return;
    ctx.clearRect(0,0,E('tkbOcrImage').width,E('tkbOcrImage').height);
    ctx.drawImage(canvas,0,0);
    var x=g.xs[c],y=g.rows[r].a,w=g.xs[c+1]-x,h=g.rows[r].b-y;
    ctx.strokeStyle='#ea580c';ctx.lineWidth=Math.max(3,canvas.width/450);ctx.strokeRect(x+2,y+2,w-4,h-4);
  }
  function markImage(canvas) {var c=E('tkbOcrImage');c.width=canvas.width;c.height=canvas.height;c.getContext('2d').drawImage(canvas,0,0);}
  async function readFile(file) {
    if(!file)throw new Error('Chọn ảnh TKB trước.');
    if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Chỉ hỗ trợ JPG, PNG, WebP.');
    if(file.size>15*1024*1024)throw new Error('Ảnh vượt 15 MB, vui lòng giảm dung lượng.');
    var img=await createImageBitmap(file);
    var target=Math.min(1,2100/Math.max(img.width,img.height));
    if(img.width*target<550)throw new Error('Ảnh quá nhỏ để nhận diện ổn định. Vui lòng dùng ảnh rõ hơn.');
    var canvas=document.createElement('canvas');canvas.width=Math.floor(img.width*target);canvas.height=Math.floor(img.height*target);
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,canvas.width,canvas.height);img.close();return canvas;
  }
  async function scan() {
    await stop();E('tkbOcrChecked').checked=false;var job=state.job, f=E('tkbOcrFile').files[0];warn('');E('tkbOcrTable').innerHTML='';state.cells=[];state.grid=null;state.applied=false;
    try {
      dis(true);status('Đang đọc ảnh…');progress(3);state.canvas=await readFile(f);markImage(state.canvas);
      status('Đang nạp OCR tiếng Việt trong trình duyệt (lần đầu có thể lâu)…');progress(8);
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');if(job!==state.job)return;
      state.worker=await Tesseract.createWorker('vie+eng',1,{logger:function(m){if(job!==state.job)return;if(m.status==='recognizing text')progress(15+Math.floor((m.progress||0)*65));}});
      if(job!==state.job){try{await state.worker.terminate();}catch(e){}state.worker=null;return;}
      var result=await state.worker.recognize(state.canvas, {}, { text:true, blocks:true });
      if(job!==state.job)return;
      var words=result.data.words||[];
      if(!words.length && Array.isArray(result.data.blocks)){
        result.data.blocks.forEach(function(b){(b.paragraphs||[]).forEach(function(p){(p.lines||[]).forEach(function(l){(l.words||[]).forEach(function(w){words.push(w);});});});});
      }
      words=words.filter(function(w){return w.text && w.bbox && Number(w.confidence == null ? 70 : w.confidence)>10;});
      status('Đang ghép tọa độ chữ với đường kẻ bảng…');progress(85);
      if(words.length<8)throw new Error('OCR không trả đủ vị trí chữ (bounding boxes). Không tự điền lịch vì có thể sai ô.');
      state.grid=mockDetector(state.canvas,words);
      for(var r=0;r<9;r++)for(var c=0;c<5;c++){
        var row=state.grid.rows[r],bounds=state.grid.xs;
        var ws=pickText(words,bounds[c],bounds[c+1],row.a,row.b);
        var raw=linesFromWords(ws).join('\n');var obj=normalizeClass(raw);
        obj.uncertain=obj.uncertain || ws.some(function(w){return w.confidence != null && w.confidence<65;});
        state.cells.push(obj);
      }
      var detected=state.cells.filter(function(x){return x.text;}).length;
      if(detected<2)throw new Error('OCR không nhận ra đủ tên lớp hợp lệ. Vui lòng chụp rõ hơn; TKB cũ được giữ nguyên.');
      var ambiguous=state.cells.filter(function(x){return x.uncertain;}).length;
      drawPreview();
      var issues=[];
      if(state.grid.missingRightEdge)issues.push('Ảnh thiếu viền phải, cột Thứ 6 đã gắn theo mép ảnh: cần kiểm tra tất cả ô Thứ 6.');
      if(ambiguous)issues.push('Có '+ambiguous+' ô OCR chưa chắc chắn. Thầy kiểm tra và sửa ô vàng trước khi áp dụng.');
      warn(issues.join(' '));
      progress(100);status('Đã quét xong. Đối chiếu ảnh gốc, sửa các ô nếu cần rồi mới áp dụng.');
    }catch(e){if(job===state.job){status('Không áp dụng: '+(e.message||e),true);warn('Dữ liệu TKB hiện tại chưa bị thay đổi.');state.grid=null;}}
    finally{if(job===state.job){dis(false);if(state.worker){try{await state.worker.terminate();}catch(e){}state.worker=null;}}}
  }
  function apply(andSave){
    if(!state.grid||state.cells.length!==45){status('Chưa có kết quả quét hợp lệ.',true);return;}
    var edits=E('tkbOcrTable').querySelectorAll('textarea[data-ocr-r]');
    var changes=[];
    edits.forEach(function(el){var r=Number(el.dataset.ocrR),c=Number(el.dataset.ocrC),val=el.value.replace(/\r/g,'').trim();
      var line=val.split(/\n/);if(line.length>2)throw new Error('Mỗi ô tối đa hai dòng: lớp và phân môn.');
      changes.push({r:r,c:c,value:val});
    });
    if(changes.length!==45){status('Thiếu ô xem trước. Dừng áp dụng.',true);return;}
    if(!E('tkbOcrChecked').checked){status('Hãy xác nhận đã rà lại bảng nhận diện và các ô trống.',true);return;}
    if(!confirm('Áp dụng 45 ô Thứ 2–Thứ 6 vào 5 tiết sáng và 4 tiết chiều? Các ô trống trong ảnh cũng sẽ thay ô tương ứng thành trống. Dữ liệu Thứ 7, CN và ca trung tâm không đổi.'))return;
    // Không gọi API và không sửa dữ liệu nguồn trước khi người dùng xác nhận.
    var editsExisting=document.querySelectorAll('#tblFullTKBBody div[data-r][data-c]');
    if(!editsExisting.length){status('Bảng TKB trên trang chưa được khởi tạo. Mở lại tab Lịch dạy.',true);return;}
    changes.forEach(function(ch){
      var el=document.querySelector('#tblFullTKBBody div[data-r="'+ch.r+'"][data-c="'+ch.c+'"]');
      if(!el)return;
      el.setAttribute('data-val',ch.value);
      el.innerHTML=typeof renderTkbCellHtml==='function'?renderTkbCellHtml(esc(ch.value)):esc(ch.value).replace(/\n/g,'<br>');
      var parent=el.parentElement;
      if(parent && typeof getClassStyle==='function')parent.className='tkb-badge pointer-events-none '+(ch.value?getClassStyle(ch.value,false):'');
    });
    state.applied=true;hide();if(typeof showToast==='function')showToast('Đã áp dụng bản xem trước vào TKB. Bấm Lưu để ghi vào Supabase.');
    if(andSave && typeof saveAllScheduleAndNotes==='function')saveAllScheduleAndNotes();
  }
  function buildModal(){
    var node=document.createElement('div');node.id='tkbOcrModal';node.className='hidden fixed inset-0 z-[100] bg-slate-950/70 p-2 sm:p-5';node.style.display='none';
    node.innerHTML='<div class="mx-auto w-full max-w-7xl h-full flex flex-col bg-white shadow-2xl rounded-2xl overflow-hidden">'+
      '<div class="flex justify-between gap-2 items-center p-3 bg-[#0b2447] text-white"><b>Nhập TKB từ ảnh · Thứ 2–Thứ 6</b><button type="button" id="tkbOcrClose" class="px-3 py-1 bg-white/20 rounded-lg">Đóng</button></div>'+
      '<div class="flex flex-wrap items-center gap-2 p-3 border-b bg-slate-50"><input id="tkbOcrFile" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" class="text-xs max-w-[230px]" />'+
      '<button id="tkbOcrScan" type="button" class="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold">Quét / Quét lại</button><button id="tkbOcrCancel" type="button" class="px-3 py-2 bg-slate-200 rounded-lg text-xs font-bold">Hủy</button>'+
      '<button id="tkbOcrApply" type="button" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Xác nhận & Áp dụng</button><button id="tkbOcrSave" type="button" class="px-3 py-2 bg-blue-800 text-white rounded-lg text-xs font-bold">Áp dụng & Lưu TKB</button></div>'+
      '<div class="px-3 py-2"><progress id="tkbOcrProgress" max="100" value="0" class="w-full h-2"></progress><p id="tkbOcrStatus" class="text-xs">Chưa chọn ảnh. Không gửi dữ liệu lên AI API.</p><p id="tkbOcrWarnings" hidden class="text-amber-800 bg-amber-50 p-2 text-xs rounded-lg"></p></div>'+
      '<div class="grid md:grid-cols-2 flex-1 overflow-hidden"><div class="overflow-auto p-3 border-r"><p class="font-semibold text-sm mb-2">Ảnh gốc (bấm ô bảng bên phải để đối chiếu)</p><canvas id="tkbOcrImage" class="w-full h-auto border"></canvas></div><div class="overflow-auto p-3"><p class="font-semibold text-sm mb-2">Xem trước · Lớp ở trên, phân môn ở dưới (TN cho trải nghiệm)</p><div id="tkbOcrTable" class="min-w-[510px]"></div></div></div>'+ 
      '<label class="px-3 py-1 flex gap-2 items-center text-xs font-semibold"><input type="checkbox" id="tkbOcrChecked" /> Tôi đã đối chiếu bảng 45 ô với ảnh gốc, kể cả ô trống và cột Thứ 6.</label>'+ 
      '<div class="p-2 bg-amber-50 text-xs text-amber-900">Chỉ nhập lịch ở trường: 5 tiết sáng + 4 tiết chiều. Không nhận Thứ 7, Chủ nhật; không tự xóa các ca trung tâm. Kiểm tra kỹ ô trống trước khi áp dụng.</div></div>';
    document.body.appendChild(node);
    E('tkbOcrClose').onclick=window.mrvyCloseTkbOcr;
    E('tkbOcrCancel').onclick=function(){window.mrvyCloseTkbOcr();};
    E('tkbOcrScan').onclick=scan;
    E('tkbOcrApply').onclick=function(){try{apply(false);}catch(e){status(e.message,true);}};
    E('tkbOcrSave').onclick=function(){try{apply(true);}catch(e){status(e.message,true);}};
    E('tkbOcrFile').onchange=function(){stop();E('tkbOcrChecked').checked=false;state.grid=null;state.cells=[];state.canvas=null;E('tkbOcrTable').innerHTML='';progress(0);status('Ảnh đã chọn. Bấm Quét để nhận diện.');};
    E('tkbOcrTable').addEventListener('focusin',function(ev){var el=ev.target;if(el.matches('textarea[data-ocr-r]'))highlight(Number(el.dataset.ocrR),Number(el.dataset.ocrC));});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',buildModal);else buildModal();
})();
