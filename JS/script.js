import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, set, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 🌟 QUÂN ƠI: Cấu hình Firebase của dự án nhà bếp
const firebaseConfig = {
    apiKey: "AIzaSyCaBtYNbGof7YT44ht4Q3f7WH7uTIC-b44",
    authDomain: "nckh-27a54.firebaseapp.com", 
    databaseURL: "https://nckh-27a54-default-rtdb.asia-southeast1.firebasedatabase.app", 
    projectId: "nckh-27a54", 
    storageBucket: "nckh-27a54.firebasestorage.app", 
    messagingSenderId: "841432676996", 
    appId: "1:841432676996:web:dbce6ee6a223549bbc20d1", 
    measurementId: "G-3GFN7S6S4S" 
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Các biến toàn cục quản lý giao diện
let isAutoMode = true;
let lastUpdateTime = Date.now();
const mainBody = document.getElementById("main-body");
const fireBanner = document.getElementById("fire-banner");

// 🔊 --- CẤU HÌNH ĐỐI TƯỢNG ÂM THANH PHÁT TỰ ĐỘNG KHÔNG CẦN MP3 ---
let audioCtx = null;
let alarmInterval = null;

function batCoiBaoDongWeb() {
    if (alarmInterval) return; // Nếu còi đang hú rồi thì bỏ qua không tạo trùng

    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    let toggle = true;
    // Vòng lặp phát âm thanh ngắt quãng tít...tít... liên tục mỗi 300ms
    alarmInterval = setInterval(() => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        let oscillator = audioCtx.createOscillator();
        let gainNode = audioCtx.createGain();

        oscillator.type = 'sine'; // Sóng sine giúp tiếng kêu thanh và vang
        
        // Hoán đổi tần số giữa 1000Hz và 600Hz liên tục để giả lập còi cứu hỏa
        oscillator.frequency.setValueAtTime(toggle ? 1000 : 600, audioCtx.currentTime);
        toggle = !toggle;
        
        // Thiết lập âm lượng (0.2 tức là 20% âm lượng, tránh bị chói tai khi test)
        gainNode.gain.setValueAtTime(0.7, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.25); // Kêu trong 0.25 giây rồi ngắt
    }, 300); 
}

function tatCoiBaoDongWeb() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
}

// --- THIẾT LẬP ĐỒ THỊ REALTIME CHART.JS ---
const ctx = document.getElementById('realtimeChart').getContext('2d');
const maxDataPoints = 15; 

const realtimeChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], 
        datasets: [
            {
                label: 'Khí Gas (PPM)',
                data: [],
                borderColor: '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderWidth: 2,
                yAxisID: 'y-gas',
                tension: 0.3,
                fill: true
            },
            {
                label: 'Nhiệt độ (°C)',
                data: [],
                borderColor: '#f97316',
                backgroundColor: 'rgba(249, 115, 22, 0.05)',
                borderWidth: 2,
                yAxisID: 'y-temp',
                tension: 0.3,
                fill: false
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                grid: { color: 'rgba(51, 65, 85, 0.3)' }, 
                ticks: { color: '#94a3b8', font: { size: 10 } }
            },
            'y-gas': {
                type: 'linear',
                position: 'left',
                min: 0,
                max: 1000, 
                grid: { color: 'rgba(51, 65, 85, 0.5)' }, 
                ticks: { color: '#22c55e', font: { size: 10 } },
                title: { display: true, text: 'Gas (PPM)', color: '#22c55e', font: { size: 10 } }
            },
            'y-temp': {
                type: 'linear',
                position: 'right',
                min: 0,
                max: 100, 
                grid: { drawOnChartArea: false }, 
                ticks: { color: '#f97316', font: { size: 10 } },
                title: { display: true, text: 'Nhiệt độ (°C)', color: '#f97316', font: { size: 10 } }
            }
        },
        plugins: {
            legend: {
                labels: { color: '#f1f5f9', font: { size: 11, weight: 'bold' } }
            }
        }
    }
});

function addChartData(timeLabel, gasVal, tempVal) {
    const labels = realtimeChart.data.labels;
    const gasData = realtimeChart.data.datasets[0].data;
    const tempData = realtimeChart.data.datasets[1].data;

    if (labels.length >= maxDataPoints) {
        labels.shift();
        gasData.shift();
        tempData.shift();
    }

    labels.push(timeLabel);
    gasData.push(gasVal);
    tempData.push(tempVal);

    if (gasVal > 1000) {
        realtimeChart.options.scales['y-gas'].max = Math.ceil((gasVal + 500) / 1000) * 1000;
    } else {
        realtimeChart.options.scales['y-gas'].max = 1000;
    }

    realtimeChart.update('none'); 
}

// --- LẮNG NGHE DỮ LIỆU TỪ ESP32 (/kitchen) ---
const kitchenRef = ref(db, 'kitchen');
onValue(kitchenRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        lastUpdateTime = Date.now();
        updateConnectionState(true);

        // 1. Phân tích gas
        const rawGas = parseFloat(data.gas || 0); 
        document.getElementById("val-gas").innerText = rawGas.toFixed(1); 

        const gasPercent = Math.min((rawGas * 100) / 1000, 100); 
        const gasProgress = document.getElementById("gas-progress");
        if (gasProgress) gasProgress.style.width = `${gasPercent}%`;

        const gasBadge = document.getElementById("gas-badge");
        if (rawGas > 300) { 
            document.getElementById("val-gas").className = "text-5xl font-black text-red-500 tracking-tight transition-all duration-300";
            if (gasProgress) gasProgress.className = "bg-red-500 h-full rounded-full transition-all duration-500";
            if (gasBadge) { gasBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20"; gasBadge.innerText = "NGUY HIỂM"; }
        } else if (rawGas > 150) { 
            document.getElementById("val-gas").className = "text-5xl font-black text-yellow-500 tracking-tight transition-all duration-300";
            if (gasProgress) gasProgress.className = "bg-yellow-500 h-full rounded-full transition-all duration-500";
            if (gasBadge) { gasBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"; gasBadge.innerText = "CÓ MÙI GAS NHẸ"; }
        } else {
            document.getElementById("val-gas").className = "text-5xl font-black text-green-400 tracking-tight transition-all duration-300";
            if (gasProgress) gasProgress.className = "bg-green-500 h-full rounded-full transition-all duration-500";
            if (gasBadge) { gasBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20"; gasBadge.innerText = "AN TOÀN"; }
        }

        // 2. Phân tích Nhiệt độ
        const temp = parseFloat(data.temperature || 0).toFixed(1);
        document.getElementById("val-temp").innerText = temp;
        const tempBadge = document.getElementById("temp-badge");
        if (tempBadge) {
            if (temp > 50.0) {
                tempBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20";
                tempBadge.innerText = "QUÁ NÓNG";
            } else if (temp > 35.0) {
                tempBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20";
                tempBadge.innerText = "HƠI ẤM";
            } else {
                tempBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20";
                tempBadge.innerText = "MÁT MẺ";
            }
        }

        // 3. Phân tích Độ ẩm
        const humi = parseFloat(data.humidity || 0).toFixed(1);
        document.getElementById("val-humi").innerText = humi;

        // 4. Phân tích cảm biến lửa dạng chữ
        const flameDetected = data.flame === true || data.flame === "true" || data.flame === 1 || data.flame === "1";
        const flameTxt = document.getElementById("val-flame-txt");
        
        // 5. PHÒNG CHÁY KHẨN CẤP & PHÁT TIẾNG CÒI WEB HÚ LẬP TỨC
        const canhBaoChay = data.canh_bao_chay === true || data.canh_bao_chay === "true" || data.canh_bao_chay === 1 || data.canh_bao_chay === "1";
        
        if (flameDetected || canhBaoChay) {
            if (flameTxt) flameTxt.innerHTML = `<span class="text-red-500 font-black pulse-active flex items-center gap-1 text-xl"><i class="fa-solid fa-fire-flame-curved animate-bounce"></i> NGUY HIỂM: CÓ CHÁY NHA BẾP!</span>`;
            if (mainBody) mainBody.className = "text-slate-100 min-h-screen fire-emergency transition-all duration-100";
            if (fireBanner) fireBanner.classList.remove("hidden");
            
            // 🔊 KÍCH HOẠT CÒI HÚ MÁY TÍNH REATIME KHÔNG ĐỘ TRỄ
            batCoiBaoDongWeb();

            // Nếu đang Manual, tự kích hoạt Buzzer phần cứng lên Firebase luôn để mạch hú còi đồng bộ
            const buzzerBtn = document.getElementById("btn-buzzer");
            if (buzzerBtn && buzzerBtn.innerText === "OFF" && !isAutoMode) {
                updateControl('buzzer_btn', true);
            }
        } else {
            if (flameTxt) flameTxt.innerHTML = `<span class="text-green-400 flex items-center gap-1"><i class="fa-solid fa-shield-halved"></i> Không phát hiện lửa</span>`;
            if (mainBody) mainBody.className = "text-slate-100 min-h-screen transition-all duration-500";
            if (fireBanner) fireBanner.classList.add("hidden");

            // 🔇 TẮT CÒI HÚ KHI KHÔNG CÒN NGUY HIỂM
            tatCoiBaoDongWeb();
        }

        // Cập nhật lên biểu đồ
        const nowTime = new Date().toLocaleTimeString('vi-VN', { hour12: false }); 
        addChartData(nowTime, rawGas, parseFloat(temp)); 
    }
});

// --- LẮNG NGHE LỆNH & TRẠNG THÁI TỪ /Control ---
const controlRef = ref(db, 'Control');
onValue(controlRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        isAutoMode = data.auto_mode === true || data.auto_mode === "true" || data.auto_mode === 1;
        const modeToggle = document.getElementById("mode-toggle");
        const modeText = document.getElementById("mode-text");
        if (modeToggle) modeToggle.checked = !isAutoMode; 
        if (modeText) modeText.innerText = isAutoMode ? "AUTO" : "MANUAL";

        const lockAlert = document.getElementById("auto-lock-alert");
        const manualButtons = [
            document.getElementById("btn-relay1"),
            document.getElementById("btn-relay2"),
            document.getElementById("btn-buzzer")
        ];
        const servoSlider = document.getElementById("servo-slider");

        if (isAutoMode) {
            if (lockAlert) lockAlert.classList.remove("hidden");
            manualButtons.forEach(btn => {
                if (btn) {
                    btn.disabled = true;
                    btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-slate-700 text-slate-500 cursor-not-allowed";
                }
            });
            if (servoSlider) servoSlider.disabled = true;
        } else {
            if (lockAlert) lockAlert.classList.add("hidden");
            manualButtons.forEach(btn => { if (btn) btn.disabled = false; });
            if (servoSlider) servoSlider.disabled = false;
        }

        updateButtonState("btn-relay1", "fan-icon", "fan-icon-bg", data.relay1_btn, "fa-lightbulb", "pulse"); 
        updateButtonState("btn-relay2", "pump-icon", "pump-icon-bg", data.relay2_btn, "fa-fan", "spin"); 
        updateButtonState("btn-buzzer", "buzzer-icon", "buzzer-icon-bg", data.buzzer_btn, "fa-volume-high", "pulse");

        const firebaseServoVal = parseInt(data.servo_pos || 0);
        const sliderVal = 180 - firebaseServoVal; 

        if (servoSlider) {
            servoSlider.value = sliderVal;
            const servoDegVal = document.getElementById("servo-deg-val");
            if (servoDegVal) servoDegVal.innerText = `${sliderVal}°`;
        }
    }
});

function updateButtonState(btnId, iconId, bgId, state, baseIconClass, effectClass) {
    const btn = document.getElementById(btnId);
    const icon = document.getElementById(iconId);
    const bg = document.getElementById(bgId);
    if (!btn || !icon || !bg) return;
    
    const isOn = state === true || state === "true" || state === 1 || state === "1";

    if (isOn) {
        btn.innerText = "ON";
        if (!isAutoMode) {
            btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-green-500 hover:bg-green-600 text-white shadow-md shadow-green-500/20 cursor-pointer";
        } else {
            btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-green-500/30 text-green-400/80 cursor-not-allowed";
        }
        bg.className = "bg-green-500/10 p-2.5 rounded-lg border border-green-500/30";

        if (effectClass === "spin") {
            icon.className = `fa-solid ${baseIconClass} text-green-400 animate-spin`;
        } else if (effectClass === "bounce") {
            icon.className = `fa-solid ${baseIconClass} text-green-400 animate-bounce`;
        } else {
            icon.className = `fa-solid ${baseIconClass} text-green-400 pulse-active`;
        }
    } else {
        btn.innerText = "OFF";
        if (!isAutoMode) {
            btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-slate-900 hover:bg-slate-900/80 text-slate-400 border border-slate-700 cursor-pointer";
        } else {
            btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-slate-800 text-slate-500 cursor-not-allowed";
        }
        bg.className = "bg-slate-800 p-2.5 rounded-lg border border-slate-700";
        icon.className = `fa-solid ${baseIconClass} text-slate-400`;
    }
}

const updateControl = (node, value) => {
    update(ref(db, 'Control'), { [node]: value })
        .catch(err => console.error("Lỗi cập nhật:", err));
};

const modeToggle = document.getElementById("mode-toggle");
if (modeToggle) {
    modeToggle.addEventListener("change", (e) => {
        const manualSelected = e.target.checked;
        updateControl('auto_mode', !manualSelected); 
    });
}

const btnRelay1 = document.getElementById("btn-relay1");
if (btnRelay1) {
    btnRelay1.addEventListener("click", () => {
        if (isAutoMode) return;
        const nextState = btnRelay1.innerText === "OFF" ? true : false;
        updateControl('relay1_btn', nextState);
    });
}

const btnRelay2 = document.getElementById("btn-relay2");
if (btnRelay2) {
    btnRelay2.addEventListener("click", () => {
        if (isAutoMode) return;
        const nextState = btnRelay2.innerText === "OFF" ? true : false;
        updateControl('relay2_btn', nextState);
    });
}

const btnBuzzer = document.getElementById("btn-buzzer");
if (btnBuzzer) {
    btnBuzzer.addEventListener("click", () => {
        if (isAutoMode) return;
        const nextState = btnBuzzer.innerText === "OFF" ? true : false;
        updateControl('buzzer_btn', nextState);
    });
}

const slider = document.getElementById("servo-slider");
if (slider) {
    slider.addEventListener("input", (e) => {
        const value = parseInt(e.target.value);
        const servoDegVal = document.getElementById("servo-deg-val");
        if (servoDegVal) servoDegVal.innerText = `${value}°`;
    });

    slider.addEventListener("change", (e) => {
        const value = parseInt(e.target.value);
        const valueGoiFirebase = 180 - value; 
        updateControl('servo_pos', valueGoiFirebase);
    });
}

function updateConnectionState(isActive) {
    const dot = document.getElementById("connection-dot");
    const text = document.getElementById("connection-status");
    if (!dot || !text) return;
    if (isActive) {
        dot.className = "w-3 h-3 rounded-full bg-green-500 pulse-active";
        text.innerText = "Mạch Online";
        text.className = "text-xs font-semibold text-green-400";
    } else {
        dot.className = "w-3 h-3 rounded-full bg-red-500";
        text.innerText = "Mạch Offline";
        text.className = "text-xs font-semibold text-red-500";
    }
}

setInterval(() => {
    const timeDiff = Date.now() - lastUpdateTime;
    if (timeDiff > 15000) { 
        updateConnectionState(false);
    }
}, 5000);

function updateClock() {
    const d = new Date();
    const timeStr = d.toLocaleTimeString('vi-VN', { hour12: false });
    const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const clockEl = document.getElementById("realtime-clock");
    const dateEl = document.getElementById("realtime-date");
    if (clockEl) clockEl.innerText = timeStr;
    if (dateEl) dateEl.innerText = dateStr;
}
setInterval(updateClock, 1000);
updateClock();