const FFmpeg = window.FFmpegWASM && window.FFmpegWASM.FFmpeg;

const FORMAT_ERROR = "이 형식은 변환이 불가합니다.";
const ENGINE_ERROR = "변환 엔진을 준비하지 못해 변환이 불가합니다.";

const workspace = document.querySelector("#workspace");
const jobsEl = document.querySelector("#jobs");
const selectAll = document.querySelector("#select-all");
const giphyForm = document.querySelector("#giphy-form");
const giphyQuery = document.querySelector("#giphy-query");
const giphyStatus = document.querySelector("#giphy-status");
const giphyResults = document.querySelector("#giphy-results");
const loadError = document.querySelector("#load-error");

const jobs = [];
let nextId = 1;
let converting = false;
let ffmpegPromise = null;
let onProgress = null;
const logs = [];

window.addMediaFiles = function addMediaFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;
  list.forEach((file) => jobs.push(createJob(file)));
  workspace.hidden = false;
  renderJobs();
  list.forEach((file, index) => previewJob(jobs[jobs.length - list.length + index]));
};

if (Array.isArray(window.__pendingFiles) && window.__pendingFiles.length) {
  window.addMediaFiles(window.__pendingFiles);
  window.__pendingFiles = [];
}

document.querySelector("#convert-selected").addEventListener("click", () => {
  convertJobs(jobs.filter((job) => job.selected && job.status !== "busy"));
});
document.querySelector("#convert-all").addEventListener("click", () => {
  convertJobs(jobs.filter((job) => job.status !== "busy"));
});
document.querySelector("#clear-done").addEventListener("click", () => {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === "done") {
      revokeJob(jobs[i]);
      jobs.splice(i, 1);
    }
  }
  renderJobs();
});
selectAll.addEventListener("change", () => {
  jobs.forEach((job) => { job.selected = selectAll.checked; });
  renderJobs();
});

giphyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = giphyQuery.value.trim();
  if (!query) {
    giphyStatus.textContent = "검색할 키워드를 입력하세요.";
    return;
  }
  giphyStatus.textContent = "Giphy에서 찾는 중...";
  giphyResults.innerHTML = "";
  try {
    const items = await searchGiphyItems(query);
    if (!items.length) {
      giphyStatus.textContent = "\"" + query + "\"에 맞는 GIF를 찾지 못했습니다.";
      return;
    }
    giphyStatus.textContent = "\"" + query + "\" 검색 결과입니다. GIF를 누르면 목록에 넣습니다.";
    items.forEach((item) => {
      if (!item.preview || !item.url) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "giphy-item";
      button.title = item.title || query;
      button.innerHTML = "<img alt=\"\" src=\"" + escapeAttr(item.preview) + "\">";
      button.addEventListener("click", () => addGiphyGif(item, query));
      giphyResults.appendChild(button);
    });
  } catch (error) {
    console.error(error);
    giphyStatus.textContent = "Giphy 검색에 연결하지 못했습니다. 인터넷 연결을 확인하세요.";
  }
});

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function parseGiphyItems(text, query) {
  const seen = new Set();
  const items = [];
  const matches = String(text).matchAll(/\/gifs\/([A-Za-z0-9][A-Za-z0-9_-]{3,})/g);
  for (const match of matches) {
    const slug = match[1].replace(/[)#?].*$/, "");
    const id = slug.split("-").pop();
    if (!id || id.length < 6 || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title: query,
      preview: "https://media.giphy.com/media/" + id + "/200.gif",
      url: "https://media.giphy.com/media/" + id + "/giphy.gif",
    });
    if (items.length >= 24) break;
  }
  return items;
}

function fromOfficialGiphy(json, query) {
  return (json.data || []).map((item) => {
    const images = item.images || {};
    return {
      id: item.id,
      title: item.title || query,
      preview: (images.fixed_height_small || images.fixed_height || images.downsized || {}).url,
      url: (images.original || images.downsized || {}).url,
    };
  }).filter((item) => item.preview && item.url);
}

async function searchGiphyItems(query) {
  try {
    const res = await fetch("/api/giphy?" + new URLSearchParams({ q: query }));
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data) && json.data.length) return json.data;
    }
  } catch (error) {}

  const key = (window.localStorage && localStorage.getItem("giphyApiKey")) || "";
  if (key) {
    try {
      const res = await fetch("https://api.giphy.com/v1/gifs/search?" + new URLSearchParams({
        api_key: key,
        q: query,
        limit: "24",
        rating: "pg-13",
        lang: "ko",
      }));
      if (res.ok) {
        const items = fromOfficialGiphy(await res.json(), query);
        if (items.length) return items;
      }
    } catch (error) {}
  }

  const sources = [
    "https://r.jina.ai/https://giphy.com/search/" + encodeURIComponent(query),
    "https://r.jina.ai/http://giphy.com/search/" + encodeURIComponent(query),
  ];
  for (const src of sources) {
    try {
      const res = await fetch(src, { headers: { Accept: "text/plain" } });
      if (!res.ok) continue;
      const items = parseGiphyItems(await res.text(), query);
      if (items.length) return items;
    } catch (error) {}
  }
  throw new Error("search failed");
}

async function fetchGifBlob(url) {
  const sources = [
    url,
    "/api/giphy-file?" + new URLSearchParams({ url }),
  ];
  for (const src of sources) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob && blob.size > 32) return blob;
    } catch (error) {}
  }
  throw new Error("gif fetch");
}

async function addGiphyGif(item, query) {
  try {
    const blob = await fetchGifBlob(item.url);
    const name = sanitizeName((item.title || query || "giphy").replace(/\s+/g, "-"), "gif");
    const file = new File([blob], name, { type: "image/gif" });
    window.addMediaFiles([file]);
    giphyStatus.textContent = name + " 을 변환 목록에 넣었습니다.";
  } catch (error) {
    console.error(error);
    giphyStatus.textContent = "선택한 GIF를 가져오지 못했습니다.";
  }
}

function createJob(file) {
  const kind = detectKind(file);
  const defaultOut = kind === "gif" ? stem(file.name) + ".mp4" : stem(file.name) + ".gif";
  return {
    id: nextId++,
    file,
    kind,
    selected: true,
    status: "ready",
    message: kind === "gif" ? "GIF입니다. 동영상으로 변환할 수 있습니다." : "동영상입니다. GIF로 변환할 수 있습니다.",
    percent: 0,
    waiting: false,
    previewUrl: placeholderUrl(file),
    outputUrl: "",
    outputType: kind === "gif" ? "video" : "gif",
    downloadName: defaultOut,
  };
}

function detectKind(file) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (type.startsWith("video/") || /\.(mp4|m4v|mov|qt|avi|wmv|asf|mkv|webm|ogv|ogg|mpeg|mpg|ts|mts|m2ts|vob|flv|f4v|3gp|3g2|divx|rm|rmvb|mxf|dv|y4m|ivf|hevc|h265|h264|av1|nut|tod|mod|ogm|nsv|amv|mjpeg|mjpg)$/.test(name)) {
    return "video";
  }
  return "unknown";
}

function stem(name) {
  const base = (name || "file").replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return ((dot > 0 ? base.slice(0, dot) : base) || "file").replace(/[\\/:*?"<>|]/g, "_");
}

function sanitizeName(name, ext) {
  const cleaned = String(name || "file").replace(/[\\/:*?"<>|]/g, "_").trim() || "file";
  const current = cleaned.toLowerCase().endsWith("." + ext) ? cleaned.slice(0, -(ext.length + 1)) : cleaned;
  return current + "." + ext;
}

function placeholderUrl(file) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e7eefc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1b298c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ext = ((file.name.split(".").pop() || "FILE") + "").slice(0, 10).toUpperCase();
  ctx.font = "700 64px 'Malgun Gothic', sans-serif";
  ctx.fillText(ext, 320, 150);
  ctx.fillStyle = "#243056";
  ctx.font = "400 28px 'Malgun Gothic', sans-serif";
  const label = file.name.length > 28 ? file.name.slice(0, 26) + "…" : file.name;
  ctx.fillText(label, 320, 220);
  return canvas.toDataURL("image/png");
}

async function previewJob(job) {
  try {
    if (job.kind === "gif") {
      job.previewUrl = URL.createObjectURL(job.file);
      renderJobs();
      return;
    }
    const frame = await captureFrame(job.file);
    job.previewUrl = URL.createObjectURL(frame);
    renderJobs();
  } catch (error) {
    job.previewUrl = placeholderUrl(job.file);
    renderJobs();
  }
}

function captureFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      if (ok) resolve(value);
      else reject(value);
    };
    const timer = setTimeout(() => finish(false, new Error("timeout")), 5000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    video.addEventListener("error", () => finish(false, new Error("decode")), { once: true });
    video.addEventListener("loadeddata", () => {
      const draw = () => {
        if (!video.videoWidth || !video.videoHeight) {
          finish(false, new Error("size"));
          return;
        }
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? finish(true, blob) : finish(false, new Error("blob")), "image/jpeg", 0.86);
      };
      const duration = video.duration;
      const seekTo = Number.isFinite(duration) && duration > 0 ? Math.min(0.12, duration / 2) : 0;
      if (seekTo > 0) {
        video.addEventListener("seeked", draw, { once: true });
        try { video.currentTime = seekTo; } catch (error) { draw(); }
      } else {
        draw();
      }
    }, { once: true });
  });
}

function renderJobs() {
  workspace.hidden = jobs.length === 0;
  jobsEl.innerHTML = "";
  jobs.forEach((job) => {
    const card = document.createElement("article");
    card.className = "job";
    const outIsGif = job.outputType === "gif";
    const convertLabel = job.kind === "gif" ? "이 GIF를 동영상으로" : "이 영상을 GIF로";
    const preview = job.outputUrl && !outIsGif
      ? "<video src=\"" + job.outputUrl + "\" muted playsinline controls></video>"
      : "<img alt=\"미리보기\" src=\"" + (job.outputUrl || job.previewUrl) + "\">";
    card.innerHTML =
      "<label class=\"job-check\"><input type=\"checkbox\" " + (job.selected ? "checked" : "") + "></label>" +
      "<div class=\"thumb-frame\">" + preview + "</div>" +
      "<div class=\"job-copy\">" +
        "<h2>" + (job.kind === "gif" ? "GIF" : "동영상") + "</h2>" +
        "<h3>" + escapeAttr(job.file.name) + "</h3>" +
        "<p class=\"status " + (job.status === "error" ? "error" : job.status === "done" ? "ok" : "") + "\">" + escapeAttr(job.message) + "</p>" +
        "<div class=\"progress-row\">" +
          "<div class=\"progress-track\" role=\"progressbar\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"" + job.percent + "\">" +
            "<div class=\"progress-fill" + (job.waiting ? " is-wait" : "") + "\" style=\"" + (job.waiting ? "" : "width:" + job.percent + "%") + "\"></div>" +
          "</div>" +
          "<span class=\"progress-percent\">" + job.percent + "%</span>" +
        "</div>" +
        "<div class=\"name-row\">" +
          "<label>저장 이름</label>" +
          "<input class=\"name-input\" type=\"text\" value=\"" + escapeAttr(job.downloadName) + "\">" +
        "</div>" +
        "<div class=\"job-actions\">" +
          "<button type=\"button\" class=\"pick convert-one\"" + (job.status === "busy" ? " disabled" : "") + ">" + convertLabel + "</button>" +
          (job.outputUrl && job.outputType === "gif" ? "<button type=\"button\" class=\"pick pick-ghost to-video\"" + (job.status === "busy" ? " disabled" : "") + ">결과 GIF를 동영상으로</button>" : "") +
          (job.outputUrl ? "<a class=\"pick download\" href=\"" + job.outputUrl + "\" download=\"" + escapeAttr(job.downloadName) + "\">다운로드</a>" : "") +
          "<button type=\"button\" class=\"text-btn remove\">빼기</button>" +
        "</div>" +
      "</div>";
    card.querySelector("input[type=checkbox]").addEventListener("change", (event) => {
      job.selected = event.target.checked;
    });
    card.querySelector(".name-input").addEventListener("input", (event) => {
      const ext = job.outputType === "gif" ? "gif" : "mp4";
      job.downloadName = sanitizeName(event.target.value, ext);
      const link = card.querySelector(".download");
      if (link) link.setAttribute("download", job.downloadName);
    });
    card.querySelector(".convert-one").addEventListener("click", () => convertJobs([job]));
    const toVideo = card.querySelector(".to-video");
    if (toVideo) {
      toVideo.addEventListener("click", () => convertOutputGif(job));
    }
    card.querySelector(".remove").addEventListener("click", () => {
      revokeJob(job);
      jobs.splice(jobs.indexOf(job), 1);
      renderJobs();
    });
    jobsEl.appendChild(card);
  });
}

function revokeJob(job) {
  if (job.previewUrl && job.previewUrl.startsWith("blob:")) URL.revokeObjectURL(job.previewUrl);
  if (job.outputUrl && job.outputUrl.startsWith("blob:")) URL.revokeObjectURL(job.outputUrl);
}

function parseDuration(log) {
  const match = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function removeQuiet(ffmpeg, path) {
  try { await ffmpeg.deleteFile(path); } catch (error) {}
}

function getFfmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      if (!FFmpeg) throw new Error("ffmpeg missing");
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => { if (message) logs.push(message); });
      ffmpeg.on("progress", (payload) => { if (onProgress) onProgress(payload); });
      await ffmpeg.load({
        coreURL: new URL("vendor/core/ffmpeg-core.umd.js", location.href).href,
        wasmURL: new URL("vendor/core/ffmpeg-core.wasm", location.href).href,
      });
      return ffmpeg;
    })().catch((error) => {
      ffmpegPromise = null;
      throw error;
    });
  }
  return ffmpegPromise;
}

function dropEngine(ffmpeg) {
  onProgress = null;
  try { if (ffmpeg) ffmpeg.terminate(); } catch (error) {}
  ffmpegPromise = null;
}

function inputNameFor(file) {
  const match = (file.name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return "input." + (match ? match[1] : "bin");
}

function setJobProgress(job, percent, message, waiting) {
  job.percent = Math.max(0, Math.min(100, Math.round(percent)));
  job.waiting = Boolean(waiting);
  if (message) job.message = message;
  renderJobs();
}

async function convertOutputGif(job) {
  if (!job.outputUrl || job.outputType !== "gif") return;
  try {
    const blob = await (await fetch(job.outputUrl)).blob();
    job.file = new File([blob], sanitizeName(job.downloadName || job.file.name, "gif"), { type: "image/gif" });
    job.kind = "gif";
    job.outputType = "video";
    job.downloadName = sanitizeName(job.downloadName || job.file.name, "mp4");
    await convertJobs([job]);
  } catch (error) {
    job.status = "error";
    job.message = FORMAT_ERROR;
    renderJobs();
  }
}

async function convertJobs(list) {
  const targets = list.filter((job) => job && job.status !== "busy");
  if (!targets.length || converting) return;
  converting = true;
  document.querySelector("#convert-selected").disabled = true;
  document.querySelector("#convert-all").disabled = true;
  try {
    for (const job of targets) {
      await convertOne(job);
    }
  } finally {
    converting = false;
    document.querySelector("#convert-selected").disabled = false;
    document.querySelector("#convert-all").disabled = false;
    renderJobs();
  }
}

async function convertOne(job) {
  job.status = "busy";
  setJobProgress(job, 0, "변환 준비 중", true);
  let ffmpeg;
  try {
    ffmpeg = await getFfmpeg();
  } catch (error) {
    job.status = "error";
    job.waiting = false;
    job.message = ENGINE_ERROR;
    renderJobs();
    return;
  }

  const toGif = job.kind !== "gif";
  const inputName = inputNameFor(job.file);
  const outputName = toGif ? "out.gif" : "out.mp4";
  try {
    await removeQuiet(ffmpeg, inputName);
    await removeQuiet(ffmpeg, outputName);
    await ffmpeg.writeFile(inputName, new Uint8Array(await job.file.arrayBuffer()));

    logs.length = 0;
    setJobProgress(job, 0, "변환 중", false);
    let duration = 0;
    let highest = 0;
    onProgress = ({ progress, time }) => {
      if (!duration) duration = parseDuration(logs.join("\n"));
      let percent = null;
      if (typeof progress === "number" && Number.isFinite(progress)) {
        percent = progress <= 1.5 ? progress * 100 : progress;
      }
      if ((percent === null || percent === 0) && duration > 0 && typeof time === "number" && time > 0) {
        percent = (time / 1e6 / duration) * 100;
      }
      if (percent === null || !Number.isFinite(percent)) return;
      highest = Math.max(highest, Math.max(0, Math.min(99, percent)));
      setJobProgress(job, highest, "변환 중", false);
    };

    const args = toGif
      ? ["-i", inputName, "-an", "-vf", "fps=30,scale=min(640\\,iw):-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5", "-loop", "0", outputName]
      : ["-i", inputName, "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", outputName];

    const code = await ffmpeg.exec(args);
    onProgress = null;
    if (code !== 0) {
      console.error(logs.slice(-40).join("\n"));
      job.status = "error";
      job.message = FORMAT_ERROR;
      dropEngine(ffmpeg);
      ffmpeg = null;
      renderJobs();
      return;
    }

    const raw = await ffmpeg.readFile(outputName);
    const bytes = raw instanceof Uint8Array ? new Uint8Array(raw) : null;
    if (!bytes || bytes.length < 16) {
      job.status = "error";
      job.message = FORMAT_ERROR;
      dropEngine(ffmpeg);
      ffmpeg = null;
      renderJobs();
      return;
    }

    if (job.outputUrl) URL.revokeObjectURL(job.outputUrl);
    job.outputType = toGif ? "gif" : "video";
    job.outputUrl = URL.createObjectURL(new Blob([bytes], { type: toGif ? "image/gif" : "video/mp4" }));
    job.downloadName = sanitizeName(job.downloadName || job.file.name, toGif ? "gif" : "mp4");
    job.status = "done";
    job.waiting = false;
    job.percent = 100;
    job.message = toGif ? "GIF 변환이 끝났습니다." : "동영상 변환이 끝났습니다.";
    renderJobs();
  } catch (error) {
    console.error(error);
    job.status = "error";
    job.waiting = false;
    job.message = FORMAT_ERROR;
    dropEngine(ffmpeg);
    ffmpeg = null;
    renderJobs();
  } finally {
    onProgress = null;
    if (ffmpeg) {
      await removeQuiet(ffmpeg, inputName);
      await removeQuiet(ffmpeg, outputName);
    }
  }
}

window.addEventListener("error", (event) => {
  if (loadError && String(event.message || "").includes("Failed to fetch")) {
    loadError.hidden = false;
    loadError.textContent = "변환 스크립트를 불러오지 못했습니다. 열기.bat 으로 다시 열어 주세요.";
  }
});
