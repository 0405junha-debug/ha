(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const tabs = $$('.mode-tab');
  const editor = $('#editor-view');
  const generator = $('#generator-view');
  const upload = $('#gif-upload');
  const input = $('#gif-file');
  const message = $('#gif-upload-message');
  const workbench = $('#gif-workbench');
  const originalContent = $('#original-content');
  const resultPanel = $('#result-panel');
  const resultContent = $('#result-content');
  const toolPicker = $('#tool-picker');
  const toolPanel = $('#editor-tool-panel');
  const title = $('#tool-panel-title');
  const filename = $('#save-filename');
  const folderLabel = $('#save-folder-label');
  const saveButton = $('#save-edited');
  const toolNames = { resize: 'Resize', crop: 'Crop', downsize: 'Downsizing', format: 'Format Convert', rotate: 'Rotate', optimize: 'Optimize', reverse: 'Reverse', speed: 'Speed', cut: 'Cut' };
  const state = { file: null, width: 0, height: 0, duration: 0, output: null, outputBlob: null, outputName: '', outputType: 'image/gif', folder: null, busy: false, ratioLocked: true, originalUrl: '' };

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((item) => item.classList.toggle('is-active', item === tab));
    const isEditor = tab.dataset.view === 'editor-view';
    editor.hidden = !isEditor;
    generator.hidden = isEditor;
  }));

  function report(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
    message.hidden = !text;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function cleanStem(name) {
    return (name || 'animation.gif').replace(/[\\/:*?"<>|]/g, '_').replace(/\.gif$/i, '') || 'animation';
  }

  function gifDuration(bytes) {
    let total = 0;
    for (let i = 13; i < bytes.length;) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4 && i + 7 < bytes.length) {
        total += (bytes[i + 4] | (bytes[i + 5] << 8)) * 10;
        i += 8;
      } else i++;
    }
    return total / 1000;
  }

  function showMeta(file, width, height, duration) {
    const meta = document.createElement('div');
    meta.className = 'gif-meta';
    meta.innerHTML = `<span>${width} × ${height}</span><span>${formatBytes(file.size)}</span><span>${duration ? `${duration.toFixed(2)}초` : '애니메이션'}</span>`;
    return meta;
  }

  function displayOriginal(file) {
    originalContent.replaceChildren();
    const img = document.createElement('img');
    img.className = 'gif-preview';
    img.alt = '원본 GIF 미리보기';
    state.originalUrl = URL.createObjectURL(file);
    img.src = state.originalUrl;
    originalContent.append(img, showMeta(file, state.width, state.height, state.duration));
  }

  async function loadGif(file) {
    if (!file) return;
    if (file.type !== 'image/gif' && !/\.gif$/i.test(file.name)) {
      report('GIF 형식 파일만 편집할 수 있어요. 파일 형식을 확인한 뒤 .GIF 파일을 선택해 주세요.', true);
      input.value = '';
      return;
    }
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.output) URL.revokeObjectURL(state.output);
    state.file = file;
    state.output = null;
    state.outputBlob = null;
    resultPanel.hidden = true;
    saveButton.disabled = true;
    const header = new Uint8Array(await file.slice(0, 13).arrayBuffer());
    if (header.length < 10 || new TextDecoder().decode(header.slice(0, 6)) !== 'GIF87a' && new TextDecoder().decode(header.slice(0, 6)) !== 'GIF89a') {
      state.file = null;
      report('선택한 파일의 실제 내용이 GIF가 아닙니다. 편집 가능한 포맷은 GIF입니다.', true);
      return;
    }
    state.width = header[6] | (header[7] << 8);
    state.height = header[8] | (header[9] << 8);
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.duration = gifDuration(bytes);
    upload.hidden = true;
    report('GIF 파일을 불러왔습니다. 편집 도구를 선택해 주세요.');
    workbench.hidden = false;
    displayOriginal(file);
    filename.value = `${cleanStem(file.name)}_ed.gif`;
    folderLabel.textContent = '다운로드 폴더 (브라우저 기본 위치)';
    resetToolPanel();
  }

  input.addEventListener('change', () => loadGif(input.files && input.files[0]));
  ['dragenter', 'dragover'].forEach((eventName) => upload.addEventListener(eventName, (event) => { event.preventDefault(); upload.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((eventName) => upload.addEventListener(eventName, (event) => { event.preventDefault(); upload.classList.remove('is-over'); }));
  upload.addEventListener('drop', (event) => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || files.length !== 1) return report('GIF 파일은 한 번에 하나씩 선택해 주세요.', true);
    loadGif(files[0]);
  });

  function resetToolPanel() {
    toolPicker.hidden = false;
    toolPanel.hidden = true;
    title.textContent = '편집 도구';
    $$('.tool-button').forEach((button) => button.classList.remove('selected'));
  }

  function field(label, control) {
    const wrap = document.createElement('label');
    wrap.className = 'control-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    wrap.append(caption, control);
    return wrap;
  }

  function select(options, value) {
    const node = document.createElement('select');
    node.className = 'editor-select';
    options.forEach(([text, val]) => {
      const option = document.createElement('option'); option.value = val; option.textContent = text; node.append(option);
    });
    if (value) node.value = value;
    return node;
  }

  function numberInput(value, min = 0, max = 9999, step = 1) {
    const node = document.createElement('input'); node.type = 'number'; node.className = 'editor-input'; node.value = value; node.min = min; node.max = max; node.step = step; return node;
  }

  function checkbox(label, checked = true) {
    const node = document.createElement('label'); node.className = 'check option-check';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    node.append(input, document.createTextNode(label)); return { node, input };
  }

  function openTool(name) {
    if (!state.file) return;
    $$('.tool-button').forEach((button) => button.classList.toggle('selected', button.dataset.tool === name));
    toolPicker.hidden = true;
    toolPanel.hidden = false;
    title.textContent = toolNames[name];
    toolPanel.replaceChildren();
    const form = document.createElement('div'); form.className = 'tool-controls';
    const add = (...nodes) => nodes.forEach((node) => form.append(node));
    const extras = {};
    if (name === 'resize') {
      const minW = Math.max(1, Math.round(state.width * 0.05)), maxW = Math.max(1, Math.round(state.width * 3));
      const minH = Math.max(1, Math.round(state.height * 0.05)), maxH = Math.max(1, Math.round(state.height * 3));
      const xRange = document.createElement('input'); xRange.type = 'range'; xRange.min = minW; xRange.max = maxW; xRange.value = state.width;
      const yRange = document.createElement('input'); yRange.type = 'range'; yRange.min = minH; yRange.max = maxH; yRange.value = state.height;
      const xValue = numberInput(state.width, minW, maxW), yValue = numberInput(state.height, minH, maxH);
      const lock = document.createElement('button'); lock.type = 'button'; lock.className = 'ratio-lock'; lock.textContent = '🔒 비율 유지';
      const ratio = state.width / state.height;
      const updateX = (v) => { const n = Math.max(minW, Math.min(maxW, Math.round(v))); xValue.value = xRange.value = n; if (state.ratioLocked) updateY(n / ratio, false); };
      const updateY = (v, driveX = true) => { const n = Math.max(minH, Math.min(maxH, Math.round(v))); yValue.value = yRange.value = n; if (state.ratioLocked && driveX) { const x = Math.max(minW, Math.min(maxW, Math.round(n * ratio))); xValue.value = xRange.value = x; } };
      xRange.addEventListener('input', () => updateX(xRange.value)); xValue.addEventListener('input', () => updateX(xValue.value));
      yRange.addEventListener('input', () => updateY(yRange.value)); yValue.addEventListener('input', () => updateY(yValue.value));
      lock.addEventListener('click', () => { state.ratioLocked = !state.ratioLocked; lock.textContent = state.ratioLocked ? '🔒 비율 유지' : '🔓 비율 고정 해제'; });
      const axis = (label, range, value) => { const row = document.createElement('div'); row.className = 'slider-field'; const heading = document.createElement('div'); heading.className = 'slider-heading'; heading.innerHTML = `<b>${label}</b><span>${range.min}–${range.max}px</span>`; row.append(heading, range, value); return row; };
      add(axis('가로 · X', xRange, xValue), lock, axis('세로 · Y', yRange, yValue));
      extras.filter = () => [`scale=${xValue.value}:${yValue.value}:flags=lanczos`];
      extras.outputName = () => `Resized_${cleanStem(state.file.name)}.gif`;
    } else if (name === 'crop') {
      const ratio = select([['원본 비율 유지', 'original'], ['정사각형 1:1', '1:1'], ['가로 4:3', '4:3'], ['와이드 16:9', '16:9'], ['세로 3:4', '3:4']], 'original');
      const fill = select([['빈 영역을 단색으로 채우기', 'pad'], ['이미지를 확대해 빈 공간 없애기', 'cover']], 'pad');
      const color = document.createElement('input'); color.type = 'color'; color.value = '#ffffff';
      add(field('자르기 비율', ratio), field('남는 영역 처리', fill), field('채움 색상', color));
      extras.filter = () => {
        if (ratio.value === 'original') return ['crop=trunc(iw/2)*2:trunc(ih/2)*2'];
        const [rw, rh] = ratio.value.split(':').map(Number);
        const target = rw / rh;
        if (fill.value === 'cover') return ['crop=trunc(if(gt(iw/ih\\,' + target + ')\\,ih*' + target + '\\,iw)/2)*2:trunc(if(gt(iw/ih\\,' + target + ')\\,ih\\,iw/' + target + ')/2)*2'];
        return ['pad=ceil(if(gt(iw/ih\\,' + target + ')\\,iw\\,ih*' + target + ')/2)*2:ceil(if(gt(iw/ih\\,' + target + ')\\,iw/' + target + '\\,ih)/2)*2:(ow-iw)/2:(oh-ih)/2:' + color.value];
      };
    } else if (name === 'downsize') {
      const size = checkbox('이미지 해상도를 75%로 줄이기'); const frames = checkbox('프레임 빈도 낮추기 (초당 15프레임)'); const palette = checkbox('색상 팔레트 줄이기 (128색)');
      add(size.node, frames.node, palette.node);
      extras.filter = () => [...(size.input.checked ? ['scale=iw*0.75:ih*0.75:flags=lanczos'] : []), ...(frames.input.checked ? ['fps=15'] : [])];
      extras.palette = () => palette.input.checked;
    } else if (name === 'format') {
      const format = select([['MP4 동영상', 'mp4'], ['JPG 이미지 (첫 프레임)', 'jpg']]); add(field('변환 형식', format));
      extras.format = () => format.value;
    } else if (name === 'rotate') {
      const turn = select([['회전 없음', 'none'], ['90° 시계 방향', 'cw'], ['180°', 'half'], ['270° 시계 방향', 'ccw']]);
      const mirror = select([['뒤집기 없음', 'none'], ['좌우 뒤집기', 'hflip'], ['상하 뒤집기', 'vflip']]);
      add(field('회전', turn), field('반전', mirror));
      extras.filter = () => [...(turn.value === 'cw' ? ['transpose=1'] : turn.value === 'ccw' ? ['transpose=2'] : turn.value === 'half' ? ['hflip', 'vflip'] : []), ...(mirror.value === 'none' ? [] : [mirror.value])];
    } else if (name === 'optimize') {
      add(document.createTextNode('프레임 차분 인코딩과 반복 재생 최적화를 적용합니다.'));
      extras.args = () => ['-gifflags', '+transdiff+offsetting'];
    } else if (name === 'reverse') {
      add(document.createTextNode('GIF 애니메이션의 프레임 순서를 거꾸로 재생합니다.'));
      extras.filter = () => ['reverse'];
    } else if (name === 'speed') {
      const speed = select([['0.25× 느리게', '0.25'], ['0.5× 느리게', '0.5'], ['1× 원래 속도', '1'], ['1.5× 빠르게', '1.5'], ['2× 빠르게', '2'], ['3× 빠르게', '3']]);
      add(field('재생 속도', speed)); extras.filter = () => [`setpts=PTS/${speed.value}`];
    } else if (name === 'cut') {
      const start = numberInput(0, 0, Math.max(0, state.duration), 0.1); start.step = '0.1';
      const duration = numberInput(Math.max(0.1, state.duration), 0.1, Math.max(0.1, state.duration), 0.1); duration.step = '0.1';
      add(field('시작 위치 (초)', start), field('잘라낼 길이 (초)', duration));
      extras.seek = () => Number(start.value) || 0; extras.duration = () => Number(duration.value) || state.duration;
      extras.filter = () => ['setpts=PTS-STARTPTS'];
    }
    const actions = document.createElement('div'); actions.className = 'tool-actions';
    const back = document.createElement('button'); back.className = 'pick pick-ghost'; back.type = 'button'; back.textContent = 'Back'; back.addEventListener('click', resetToolPanel);
    const go = document.createElement('button'); go.className = 'pick'; go.type = 'button'; go.textContent = 'Go!'; go.addEventListener('click', () => runEdit(name, extras, go));
    actions.append(back, go); toolPanel.append(form, actions);
  }

  $$('.tool-button').forEach((button) => button.addEventListener('click', () => openTool(button.dataset.tool)));

  async function getEditorFfmpeg() {
    if (!window.FFmpegWASM || !window.FFmpegWASM.FFmpeg) throw new Error('변환 엔진을 불러올 수 없습니다.');
    const ffmpeg = new window.FFmpegWASM.FFmpeg();
    await ffmpeg.load({ coreURL: new URL('vendor/core/ffmpeg-core.umd.js', location.href).href, wasmURL: new URL('vendor/core/ffmpeg-core.wasm', location.href).href });
    return ffmpeg;
  }

  async function runEdit(name, options, button) {
    if (state.busy || !state.file) return;
    state.busy = true; button.disabled = true; button.textContent = '처리 중…';
    $('#original-content').hidden = true;
    $('.panel-toggle[data-target="original-content"]').textContent = '+';
    report(`${toolNames[name]} 작업을 처리하고 있습니다.`);
    let ffmpeg;
    try {
      ffmpeg = await getEditorFfmpeg();
      const ext = state.file.name.split('.').pop().toLowerCase() || 'gif';
      const inName = `source.${ext}`;
      const format = options.format ? options.format() : 'gif';
      const outName = `edited.${format}`;
      await ffmpeg.writeFile(inName, new Uint8Array(await state.file.arrayBuffer()));
      const filters = options.filter ? options.filter() : [];
      const args = [];
      const seek = options.seek ? options.seek() : 0;
      if (seek > 0) args.push('-ss', String(seek));
      args.push('-i', inName);
      if (options.duration) args.push('-t', String(options.duration()));
      if (options.palette && options.palette()) {
        const chain = filters.length ? `${filters.join(',')},` : '';
        args.push('-filter_complex', `[0:v]${chain}split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer[out]`, '-map', '[out]');
      } else if (filters.length) args.push('-vf', filters.join(','));
      if (format === 'mp4') args.push('-an', '-movflags', '+faststart', '-pix_fmt', 'yuv420p');
      if (format === 'jpg') args.push('-frames:v', '1', '-q:v', '2');
      if (options.args) args.push(...options.args());
      if (format === 'gif') args.push('-loop', '0');
      args.push(outName);
      const exit = await ffmpeg.exec(args);
      if (exit !== 0) throw new Error('이 설정으로 GIF를 처리하지 못했습니다. 옵션을 조정해 다시 시도해 주세요.');
      const result = await ffmpeg.readFile(outName);
      const mime = format === 'mp4' ? 'video/mp4' : format === 'jpg' ? 'image/jpeg' : 'image/gif';
      if (state.output) URL.revokeObjectURL(state.output);
      state.outputBlob = new Blob([new Uint8Array(result)], { type: mime });
      state.output = URL.createObjectURL(state.outputBlob);
      state.outputType = mime;
      state.outputName = options.outputName ? options.outputName() : `${cleanStem(state.file.name)}_ed.${format}`;
      filename.value = state.outputName;
      showResult(format);
      report(`${toolNames[name]} 작업이 완료되었습니다.`);
    } catch (error) {
      console.error(error); report(error.message || '편집 중 문제가 발생했습니다. 다시 시도해 주세요.', true);
    } finally {
      if (ffmpeg) ffmpeg.terminate();
      state.busy = false; button.disabled = false; button.textContent = 'Go!';
    }
  }

  function showResult(format) {
    resultContent.replaceChildren();
    let preview;
    if (format === 'mp4') { preview = document.createElement('video'); preview.controls = true; preview.loop = true; preview.playsInline = true; }
    else { preview = document.createElement('img'); preview.alt = '편집 결과 미리보기'; }
    preview.className = 'gif-preview'; preview.src = state.output;
    resultContent.append(preview);
    const meta = document.createElement('div'); meta.className = 'gif-meta'; meta.innerHTML = `<span>${format.toUpperCase()}</span><span>${formatBytes(state.outputBlob.size)}</span>`; resultContent.append(meta);
    const download = document.createElement('a'); download.className = 'pick result-download'; download.href = state.output; download.download = state.outputName; download.textContent = '결과 파일 다운로드'; resultContent.append(download);
    $('#result-title').textContent = format === 'gif' && state.outputName.startsWith('Resized_') ? 'Resized GIF' : 'Edited GIF';
    resultPanel.hidden = false; saveButton.disabled = false;
  }

  $$('.panel-toggle').forEach((button) => button.addEventListener('click', () => {
    const content = document.getElementById(button.dataset.target); content.hidden = !content.hidden;
    button.textContent = content.hidden ? '+' : '−'; button.setAttribute('aria-expanded', String(!content.hidden));
  }));

  $('#choose-folder').addEventListener('click', async () => {
    if (!window.showDirectoryPicker) { folderLabel.textContent = '다운로드 폴더 (현재 브라우저에서 폴더 선택을 지원하지 않음)'; return; }
    try { state.folder = await window.showDirectoryPicker({ mode: 'readwrite' }); folderLabel.textContent = state.folder.name; }
    catch (error) { if (error.name !== 'AbortError') report('저장 폴더를 선택하지 못했습니다.', true); }
  });

  filename.addEventListener('input', () => {
    if (!state.output) return;
    const ext = state.outputName.split('.').pop();
    let value = filename.value.replace(/[\\/:*?"<>|]/g, '_');
    if (!value.toLowerCase().endsWith(`.${ext}`)) value = `${value.replace(/\.[^.]*$/, '')}.${ext}`;
    const link = $('.result-download', resultContent); if (link) link.download = value;
  });

  saveButton.addEventListener('click', async () => {
    if (!state.output) return;
    const ext = state.outputName.split('.').pop();
    let name = filename.value.replace(/[\\/:*?"<>|]/g, '_').trim() || state.outputName;
    if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name.replace(/\.[^.]*$/, '')}.${ext}`;
    const blob = state.outputBlob;
    try {
      if (state.folder) {
        const handle = await state.folder.getFileHandle(name, { create: true });
        const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: `${ext.toUpperCase()} 파일`, accept: { [blob.type]: [`.${ext}`] } }] });
        const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      } else {
        const a = document.createElement('a'); a.href = state.output; a.download = name; a.click();
      }
      report(`${name} 파일을 저장했습니다.`);
    } catch (error) { if (error.name !== 'AbortError') report('파일을 저장하지 못했습니다.', true); }
  });
})();
