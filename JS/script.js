import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, set, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 🌟 QUÂN ƠI: Bạn chỉ cần điền cấu hình Firebase của bạn vào đây nhé!
// Hãy copy y hệt config từ Firebase Console của dự án của bạn đè lên đây.
const firebaseConfig = {
    apiKey: "AIzaSyCaBtYNbGof7YT44ht4Q3f7WH7uTIC-b44",
    authDomain: "nckh-27a54.firebaseapp.com", // Thay thế bằng authDomain của bạn
    databaseURL: "https://nckh-27a54-default-rtdb.asia-southeast1.firebasedatabase.app", // Cực kỳ quan trọng: Điền đúng Database URL này nha Quân
    projectId: "nckh-27a54", // Thay thế bằng projectId của bạn
    storageBucket: "nckh-27a54.firebasestorage.app", // Thay thế bằng storageBucket của bạn
    messagingSenderId: "841432676996", // Thay thế bằng messagingSenderId của bạn
    appId: "1:841432676996:web:dbce6ee6a223549bbc20d1", // Thay thế bằng appId của bạn
    measurementId: "G-3GFN7S6S4S" // Thay thế bằng measurementId của bạn
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Các biến toàn cục quản lý giao diện
let isAutoMode = true;
let lastUpdateTime = Date.now();
const mainBody = document.getElementById("main-body");
const fireBanner = document.getElementById("fire-banner");

// --- THIẾT LẬP ĐỒ THỊ REALTIME CHART.JS ---
const ctx = document.getElementById('realtimeChart').getContext('2d');
const maxDataPoints = 15; // Số điểm dữ liệu hiển thị tối đa trên màn hình biểu đồ

const realtimeChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], // Thời gian nhận dữ liệu
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
                grid: { color: 'rgba(51, 65, 85, 0.3)' }, // #334155/30
                ticks: { color: '#94a3b8', font: { size: 10 } }
            },
            'y-gas': {
                type: 'linear',
                position: 'left',
                min: 0,
                max: 1000, // Thang đo gas chuẩn
                grid: { color: 'rgba(51, 65, 85, 0.5)' }, // #334155/50
                ticks: { color: '#22c55e', font: { size: 10 } },
                title: { display: true, text: 'Gas (PPM)', color: '#22c55e', font: { size: 10 } }
            },
            'y-temp': {
                type: 'linear',
                position: 'right',
                min: 0,
                max: 100, // Thang đo nhiệt độ chuẩn
                grid: { drawOnChartArea: false }, // Tránh vẽ vạch đè lung tung
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

// Hàm cập nhật dữ liệu mới vào biểu đồ Realtime
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

    // Tự động điều chỉnh trục Y nếu gas tăng quá cao (giới hạn 9999 của Quân)
    if (gasVal > 1000) {
        realtimeChart.options.scales['y-gas'].max = Math.ceil((gasVal + 500) / 1000) * 1000;
    } else {
        realtimeChart.options.scales['y-gas'].max = 1000;
    }

    realtimeChart.update('none'); // Update không có animation giật để mượt mà nhất
}

// --- LẮNG NGHE DỮ LIỆU TỪ ESP32 (/kitchen) ---
const kitchenRef = ref(db, 'kitchen');
onValue(kitchenRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        // Đánh dấu thời điểm cuối cùng nhận dữ liệu để kiểm tra trạng thái mạch online/offline
        lastUpdateTime = Date.now();
        updateConnectionState(true);

        // 1. Phân tích gas (Lấy số nguyên không số thập phân y hệt %.0f)
        const rawGas = parseFloat(data.gas || 0); // Lấy giá trị gas dạng số thực
        document.getElementById("val-gas").innerText = rawGas.toFixed(1); // Hiển thị với 1 chữ số thập phân

        // Cập nhật Progress Bar
        const gasPercent = Math.min((rawGas * 100) / 1000, 100); // Sử dụng rawGas cho tính toán
        const gasProgress = document.getElementById("gas-progress");
        gasProgress.style.width = `${gasPercent}%`;

        // Logic đổi màu cảnh báo Gas
        const gasBadge = document.getElementById("gas-badge");
        if (rawGas > 300) { // Sử dụng rawGas cho so sánh
            document.getElementById("val-gas").className = "text-5xl font-black text-red-500 tracking-tight transition-all duration-300";
            gasProgress.className = "bg-red-500 h-full rounded-full transition-all duration-500";
            gasBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20";
            gasBadge.innerText = "NGUY HIỂM";
        } else if (rawGas > 150) { // Sử dụng rawGas cho so sánh
            document.getElementById("val-gas").className = "text-5xl font-black text-yellow-500 tracking-tight transition-all duration-300";
            gasProgress.className = "bg-yellow-500 h-full rounded-full transition-all duration-500";
            gasBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20";
            gasBadge.innerText = "CÓ MÙI GAS NHẸ";
        } else {
            document.getElementById("val-gas").className = "text-5xl font-black text-green-400 tracking-tight transition-all duration-300";
            gasProgress.className = "bg-green-500 h-full rounded-full transition-all duration-500";
            gasBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20";
            gasBadge.innerText = "AN TOÀN";
        }

        // 2. Phân tích Nhiệt độ (Lấy 1 số lẻ thập phân)
        const temp = parseFloat(data.temperature || 0).toFixed(1);
        document.getElementById("val-temp").innerText = temp;
        const tempBadge = document.getElementById("temp-badge");
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

        // 3. Phân tích Độ ẩm (Lấy 1 số lẻ thập phân)
        const humi = parseFloat(data.humidity || 0).toFixed(1);
        document.getElementById("val-humi").innerText = humi;

        // 4. Phân tích cảm biến lửa dạng chữ
        const flameDetected = data.flame === true || data.flame === "true";
        const flameTxt = document.getElementById("val-flame-txt");
        if (flameDetected) {
            flameTxt.innerHTML = `<span class="text-red-500 font-bold pulse-active flex items-center gap-1"><i class="fa-solid fa-fire-flame-curved"></i> CÓ LỬA THỰC TẾ!</span>`;
        } else {
            flameTxt.innerHTML = `<span class="text-green-400 flex items-center gap-1"><i class="fa-solid fa-shield-halved"></i> Không phát hiện lửa</span>`;
        }

        // 5. PHÒNG CHÁY KHẨN CẤP (canh_bao_chay == true)
        const canhBaoChay = data.canh_bao_chay === true || data.canh_bao_chay === "true";
        if (canhBaoChay) {
            mainBody.className = "text-slate-100 min-h-screen fire-emergency transition-all duration-500";
            fireBanner.classList.remove("hidden");
        } else {
            mainBody.className = "text-slate-100 min-h-screen transition-all duration-500";
            fireBanner.classList.add("hidden");
        }

        // Cập nhật lên biểu đồ
                const nowTime = new Date().toLocaleTimeString('vi-VN', { hour12: false }); // Thời gian hiện tại
                addChartData(nowTime, rawGas, parseFloat(temp)); // Truyền giá trị gas dạng số thực vào biểu đồ
    }
});

// --- LẮNG NGHE LỆNH & TRẠNG THÁI TỪ /Control ---
const controlRef = ref(db, 'Control');
onValue(controlRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
// 1. Cập nhật chế độ Auto/Manual
        isAutoMode = data.auto_mode === true || data.auto_mode === "true" || data.auto_mode === 1;
        document.getElementById("mode-toggle").checked = !isAutoMode; // checked tương đương MANUAL
        document.getElementById("mode-text").innerText = isAutoMode ? "AUTO" : "MANUAL";

        // Bật/tắt giao diện cảnh báo nút khóa chế độ Auto
        const lockAlert = document.getElementById("auto-lock-alert");
        const manualButtons = [
            document.getElementById("btn-relay1"),
            document.getElementById("btn-relay2"),
            document.getElementById("btn-buzzer")
        ];
        const servoSlider = document.getElementById("servo-slider");

        if (isAutoMode) {
            lockAlert.classList.remove("hidden");
            manualButtons.forEach(btn => {
                btn.disabled = true;
                btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-slate-700 text-slate-500 cursor-not-allowed";
            });
            servoSlider.disabled = true;
        } else {
            lockAlert.classList.add("hidden");
            manualButtons.forEach(btn => btn.disabled = false);
            servoSlider.disabled = false;
        }

        // 2. Cập nhật trạng thái các nút thiết bị
        updateButtonState("btn-relay1", "fan-icon", "fan-icon-bg", data.relay1_btn, "fa-lightbulb", "pulse"); // Relay 1 là Đèn
        updateButtonState("btn-relay2", "pump-icon", "pump-icon-bg", data.relay2_btn, "fa-fan", "spin"); // Relay 2 là Quạt
        updateButtonState("btn-buzzer", "buzzer-icon", "buzzer-icon-bg", data.buzzer_btn, "fa-volume-high", "pulse");

        // 3. Cập nhật thanh trượt Servo góc
        const firebaseServoVal = parseInt(data.servo_pos || 0);
        const sliderVal = 180 - firebaseServoVal; // Đảo ngược logic cho thanh slider trên web

        servoSlider.value = sliderVal;
        document.getElementById("servo-deg-val").innerText = `${sliderVal}°`;
    }
});


// Hàm hỗ trợ đồng bộ trạng thái màu sắc & hiệu ứng chuyển động nút nhấn
function updateButtonState(btnId, iconId, bgId, state, baseIconClass, effectClass) {
    const btn = document.getElementById(btnId);
    const icon = document.getElementById(iconId);
    const bg = document.getElementById(bgId);
    const isOn = state === true || state === "true" || state === 1 || state === "1";

    if (isOn) {
        // Trạng thái BẬT
        btn.innerText = "ON";
        if (!isAutoMode) {
            btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-green-500 hover:bg-green-600 text-white shadow-md shadow-green-500/20 cursor-pointer";
        } else {
            btn.className = "px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 bg-green-500/30 text-green-400/80 cursor-not-allowed";
        }
        bg.className = "bg-green-500/10 p-2.5 rounded-lg border border-green-500/30";

        // Thêm hiệu ứng hoạt họa icon chuyển động cho sinh động
        if (effectClass === "spin") {
            icon.className = `fa-solid ${baseIconClass} text-green-400 animate-spin`;
        } else if (effectClass === "bounce") {
            icon.className = `fa-solid ${baseIconClass} text-green-400 animate-bounce`;
        } else {
            icon.className = `fa-solid ${baseIconClass} text-green-400 pulse-active`;
        }
    } else {
        // Trạng thái TẮT
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

// --- ĐIỀU KHIỂN ĐÁP ỨNG NGƯỢC TỪ TRANG WEB LÊN FIREBASE ---

// Hàm chung để cập nhật Firebase
const updateControl = (node, value) => {
    update(ref(db, 'Control'), { [node]: value })
        .catch(err => console.error("Lỗi cập nhật:", err));
};

// 1. Chuyển đổi Mode Auto/Manual
document.getElementById("mode-toggle").addEventListener("change", (e) => {
    const manualSelected = e.target.checked;
    // Gửi dữ liệu cập nhật thẳng vào nút /Control/auto_mode trên Firebase
    updateControl('auto_mode', !manualSelected); // check = true tức là Manual (auto_mode = false)
});

// 2. Nhấp nút điều khiển Relay 1 (Quạt)
document.getElementById("btn-relay1").addEventListener("click", () => {
    if (isAutoMode) return;
    const btn = document.getElementById("btn-relay1");
    const nextState = btn.innerText === "OFF" ? true : false;
    updateControl('relay1_btn', nextState);
});

// 3. Nhấp nút điều khiển Relay 2 (Bơm)
document.getElementById("btn-relay2").addEventListener("click", () => {
    if (isAutoMode) return;
    const btn = document.getElementById("btn-relay2");
    const nextState = btn.innerText === "OFF" ? true : false;
    updateControl('relay2_btn', nextState);
});

// 4. Nhấp nút điều khiển Buzzer (Còi)
document.getElementById("btn-buzzer").addEventListener("click", () => {
    if (isAutoMode) return;
    const btn = document.getElementById("btn-buzzer");
    const nextState = btn.innerText === "OFF" ? true : false;
    updateControl('buzzer_btn', nextState);
});

// 5. Kéo Servo bằng slider
const slider = document.getElementById("servo-slider");
slider.addEventListener("input", (e) => {
    const value = parseInt(e.target.value);
    document.getElementById("servo-deg-val").innerText = `${value}°`;
});

slider.addEventListener("change", (e) => {
    const value = parseInt(e.target.value);
    
    // SỬA TẠI ĐÂY: Lấy 180 trừ đi giá trị slider để quy đổi ngược lại cho mạch ESP32 hiểu
    const valueGoiFirebase = 180 - value; 
    
    // Gửi góc quay đã đảo ngược lên Firebase
    updateControl('servo_pos', valueGoiFirebase);
});

// --- CÁC TIỆN ÍCH PHỤ TRỢ (TRẠNG THÁI ONLINE & ĐỒNG HỒ) ---

// Hàm cập nhật trạng thái kết nối phần cứng dựa vào thời điểm gửi cuối cùng
function updateConnectionState(isActive) {
    const dot = document.getElementById("connection-dot");
    const text = document.getElementById("connection-status");
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

// Định kỳ 15 giây tự động kiểm tra xem ESP32 có còn phát sóng không
setInterval(() => {
    const timeDiff = Date.now() - lastUpdateTime;
    if (timeDiff > 15000) { // Quá 15 giây không thấy ESP32 gửi tin mới -> Mạch tắt điện hoặc đứt WiFi
        updateConnectionState(false);
    }
}, 5000);

// Đồng hồ hệ thống chạy góc màn hình
function updateClock() {
    const d = new Date();
    const timeStr = d.toLocaleTimeString('vi-VN', { hour12: false });
    const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    document.getElementById("realtime-clock").innerText = timeStr;
    document.getElementById("realtime-date").innerText = dateStr;
}
setInterval(updateClock, 1000);
updateClock();