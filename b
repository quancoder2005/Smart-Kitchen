#include "esp_task_wdt.h"
#include "TASK_DATA.h"

// Giữ nguyên các đối tượng mạng cốt lõi toàn cục
WiFiClientSecure ssl_client;
WiFiClientSecure ssl_client_stream;
DefaultNetwork network;
FirebaseApp app;
RealtimeDatabase Database;
NoAuth noAuth;

// Khởi tạo con trỏ quản lý kết nối
AsyncClientClass *aClient_send = nullptr;
AsyncClientClass *aClient_stream = nullptr;

// SỬ SỬA 1: Tách biệt hoàn toàn App Result (cho khởi tạo) và không gán đè vào aClient ngầm
AsyncResult appResult;
AsyncResult aResult_no_callback; // Định nghĩa thực tế của biến
// AsyncResult aResult_read_control; // Không còn dùng sau khi loại bỏ readControlFromFirebase
AsyncResult streamResult; // Dùng riêng cho việc lắng nghe Stream

SMTPSession smtp;

void khoi_tao_firebase()
{
    // 1. Thiết lập bỏ qua kiểm tra chứng chỉ SSL để ESP32 kết nối nhanh hơn
    ssl_client.setInsecure();
    ssl_client_stream.setInsecure();

    // 2. Tách biệt 2 client riêng biệt cho gửi và nhận
    if (aClient_send == nullptr)
        aClient_send = new AsyncClientClass(ssl_client, getNetwork(network));

    if (aClient_stream == nullptr)
        aClient_stream = new AsyncClientClass(ssl_client_stream, getNetwork(network));

    // 3. Khởi tạo ứng dụng Firebase kết nối với hộp thư lưu kết quả appResult riêng biệt
    initializeApp(*aClient_send, app, getAuth(noAuth), appResult);

    // 4. Liên kết Database với App và cấu hình URL đường dẫn
    app.getApp<RealtimeDatabase>(Database);
    Database.url(DATABASE_URL);

    // 5. Cấu hình đồng bộ thời gian NTP để tránh lỗi token hết hạn do sai lệch thời gian
    LOG_YELLOW("[Time] Đang đồng bộ thời gian từ Server NTP...");
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    // Mẹo: 7 * 3600 là cấu hình múi giờ GMT+7 của Việt Nam mình luôn nha Quân

    LOG_GREEN("[Firebase] Khởi tạo cấu hình hệ thống thành công!");
}

// Callback để xử lý kết quả GỬI dữ liệu cảm biến lên
void asyncResultCallback(AsyncResult &aResult)
{
    if (aResult.isError())
    {
        LOG_RED("[Firebase ERROR] Code: %d | Message: %s", aResult.error().code(), aResult.error().message().c_str());
        isSending = false;
    }

    if (aResult.available())
    {
        LOG_GREEN("[Firebase OK] Dữ liệu cảm biến đã đồng bộ thành công!");
        isSending = false;
    }
}


// gởi dữ liệu cảm biến lên Firebase
void sendSensorDataToFirebase()
{
    // Tạo JSON payload với dữ liệu cảm biến chuẩn cú pháp
    String jsonSensor = "{";
    jsonSensor += "\"temperature\":" + String(kitchenSensor.temperature, 1) + ",";
    jsonSensor += "\"humidity\":" + String(kitchenSensor.humidity, 1) + ",";
    jsonSensor += "\"gas\":" + String(kitchenSensor.gas, 1) + ",";
    jsonSensor += "\"flame\":" + String(kitchenSensor.flame_detected ? "true" : "false") + ",";  // 🌟 THÊM DẤU PHẨY Ở ĐÂY
    jsonSensor += "\"canh_bao_chay\":" + String(kitchenSensor.canh_bao_chay ? "true" : "false"); // Dòng cuối cùng không cần dấu phẩy
    jsonSensor += "}";

    // Gửi lên Firebase
    Database.set<object_t>(*aClient_send, "/kitchen", object_t(jsonSensor.c_str()), asyncResultCallback);

    LOG_CYAN("[Firebase Send] Temp: %.1f°C | Humi: %.1f%% | Gas: %.1f PPM | Fire: %s | Alert: %s",
             kitchenSensor.temperature, kitchenSensor.humidity, kitchenSensor.gas,
             kitchenSensor.flame_detected ? "YES" : "NO",
             kitchenSensor.canh_bao_chay ? "YES" : "NO");
}



// Hàm phụ trợ bóc tách giá trị từ JSON string an toàn
String getJsonValue(const String &json, const String &key, int searchFrom)
{
    int keyIdx = json.indexOf("\"" + key + "\":", searchFrom);
    if (keyIdx == -1)
        return "";

    int start = json.indexOf(":", keyIdx) + 1;
    int end = json.indexOf(",", start);
    if (end == -1)
        end = json.indexOf("}", start);

    if (end != -1 && end > start)
    {
        String val = json.substring(start, end);
        val.replace("\"", ""); // Xóa bỏ dấu ngoặc kép nếu có
        val.trim();            // Xóa khoảng trắng thừa
        return val;
    }
    return "";
}

// Callback để xử lý dữ liệu Stream từ Firebase Realtime Database
void streamCallback(AsyncResult &aResult)
{
    LOG_RED(">>> CÓ SỰ KIỆN TỪ FIREBASE <<<");

    // LOG_YELLOW("Stream callback đã kích hoạt! Path: %s", aResult.dataPath().c_str());
    if (aResult.isError())
    {
        LOG_RED("[Stream ERROR] %d: %s", aResult.error().code(), aResult.error().message().c_str());
        return;
    }

    if (aResult.available())
    {
        RealtimeDatabaseResult &data = aResult.to<RealtimeDatabaseResult>();
        LOG_CYAN("Event Data: %s", data.to<String>().c_str());

        String path = data.dataPath();
        String value = data.to<String>();

        LOG_YELLOW("[Firebase Stream] %s -> %s", path.isEmpty() ? "Root" : path.c_str(), value.c_str());

        // 🌟 SỬA LẠI: Kiểm tra cả path "/" và "/Control" để đảm bảo không sót
        if (path == "/" || path.isEmpty() || path == "/Control")
        {
            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, value);
            if (!error)
            {
                if (doc.containsKey("auto_mode")) FB_DATA.auto_mode = doc["auto_mode"];
                if (doc.containsKey("servo_pos")) FB_DATA.servo_pos = doc["servo_pos"];
                if (doc.containsKey("relay1_btn")) FB_DATA.relay1_btn = doc["relay1_btn"];
                if (doc.containsKey("relay2_btn")) FB_DATA.relay2_btn = doc["relay2_btn"];
                if (doc.containsKey("buzzer_btn")) FB_DATA.buzzer_btn = doc["buzzer_btn"];
                LOG_CYAN("[Firebase] Đã cập nhật toàn bộ cấu hình từ JSON Root");
            }
            else {
                LOG_RED("[JSON ERROR] Parse that bai: %s", error.c_str());
            }
            return;
        }

        // Cập nhật dữ liệu (Sử dụng endsWith để bắt các field dù path có / hay không)
        if (path.endsWith("auto_mode"))
            FB_DATA.auto_mode = (value == "1" || value == "true");
        else if (path.endsWith("servo_pos"))
            FB_DATA.servo_pos = value.toInt();
        else if (path.endsWith("relay1_btn"))
            FB_DATA.relay1_btn = (value == "1" || value == "true");
        else if (path.endsWith("relay2_btn"))
            FB_DATA.relay2_btn = (value == "1" || value == "true");
        else if (path.endsWith("buzzer_btn"))
            FB_DATA.buzzer_btn = (value == "1" || value == "true");
    }
}

// Định nghĩa hàm đọc lệnh thủ công (Polling)
void readControlFromFirebase() {
    if (aClient_send == nullptr || !app.ready()) return;

    // Lấy dữ liệu từ /Control dưới dạng String
    String jsonStr = Database.get<String>(*aClient_send, "/Control");
    
    if (jsonStr.length() > 2) { // Kiểm tra không rỗng
        LOG_CYAN("[Read Control] Nhận từ Firebase: %s", jsonStr.c_str());
        
        String val;
        if (!(val = getJsonValue(jsonStr, "auto_mode", 0)).isEmpty()) {
            FB_DATA.auto_mode = (val == "true" || val == "1");
            LOG_CYAN("  auto_mode: %s", FB_DATA.auto_mode ? "true" : "false");
        }
        if (!(val = getJsonValue(jsonStr, "servo_pos", 0)).isEmpty()) {
            FB_DATA.servo_pos = val.toInt();
            LOG_CYAN("  servo_pos: %d", FB_DATA.servo_pos);
        }
        if (!(val = getJsonValue(jsonStr, "relay1_btn", 0)).isEmpty()) {
            FB_DATA.relay1_btn = (val == "true" || val == "1");
            LOG_CYAN("  relay1_btn: %s", FB_DATA.relay1_btn ? "true" : "false");
        }
        if (!(val = getJsonValue(jsonStr, "relay2_btn", 0)).isEmpty()) {
            FB_DATA.relay2_btn = (val == "true" || val == "1");
            LOG_CYAN("  relay2_btn: %s", FB_DATA.relay2_btn ? "true" : "false");
        }
        if (!(val = getJsonValue(jsonStr, "buzzer_btn", 0)).isEmpty()) {
            FB_DATA.buzzer_btn = (val == "true" || val == "1");
            LOG_CYAN("  buzzer_btn: %s", FB_DATA.buzzer_btn ? "true" : "false");
        }
    }
}


// gmail callback để xử lý kết quả gửi email
void smtpCallback(SMTP_Status status)
{
    if (status.success())
    {
        LOG_GREEN("[SMTP OK] Đã gửi email cảnh báo thành công!"); // Log final success
    }
    // Không log lỗi ở đây cho các bước trung gian.
    // Hàm gui_email_canh_bao sẽ kiểm tra kết quả cuối cùng.
}

void gui_email_canh_bao(String tieuDe, String noiDung)
{
    // Thiết lập cấu hình callback để debug
    smtp.callback(smtpCallback);

    // Cấu hình dữ liệu phiên kết nối SMTP
    Session_Config config;
    config.server.host_name = SMTP_HOST;
    config.server.port = SMTP_PORT;
    config.login.email = AUTHOR_EMAIL;
    config.login.password = AUTHOR_PASSWORD;
    config.login.user_domain = "127.0.0.1";
    config.time.timezone_file = ""; // Vô hiệu hóa việc ghi file tze.txt để tránh lỗi LittleFS

    config.time.ntp_server = ""; // Tắt việc đồng bộ NTP qua file hệ thống
    // Xóa các dòng gán chuỗi rỗng cho timezone_file và ntp_server để tránh lỗi VFS path

    // 🌟 QUAN TRỌNG: Ép thư viện KHÔNG đọc/ghi file lưu trữ tạm (Bỏ qua lỗi LittleFS)
    // config.time.ntp_server = "";

    // Cấu hình nội dung Email
    SMTP_Message message;
    message.sender.name = "He thong Tu Kinh Thong Minh";
    message.sender.email = AUTHOR_EMAIL;
    message.subject = tieuDe;
    message.addRecipient("Quan Nguyen", RECIPIENT_EMAIL);

    // Thiết lập nội dung text thuần cho mail
    message.text.content = noiDung.c_str();
    message.text.charSet = "utf-8";
    message.text.transfer_encoding = Content_Transfer_Encoding::enc_7bit;

    message.priority = esp_mail_smtp_priority::esp_mail_smtp_priority_high;

    // Tiến hành kết nối và gửi mail
    if (!smtp.connect(&config))
    {
        LOG_RED("[SMTP] Khong the ket noi den SMTP Server cua Gmail!");
        return;
    }

    if (!MailClient.sendMail(&smtp, &message))
    {
        LOG_RED("[SMTP] Loi khi gui du lieu mail!");
    }
    vTaskDelay(pdMS_TO_TICKS(1000));

    // 🌟 QUAN TRỌNG: Gửi xong phải ngắt kết nối ngay để giải phóng RAM cho Firebase
    smtp.closeSession();
}

// Hàm phụ trợ để in thời gian hiện tại ra Serial Monitor sau khi đã đồng bộ thành công
void in_thoi_gian_hien_tai()
{
    time_t now = time(nullptr);            // Lấy timestamp hiện tại từ hệ thống
    struct tm *timeInfo = localtime(&now); // Chuyển đổi timestamp sang cấu trúc giờ địa phương

    // Kiểm tra xem thời gian đã được cập nhật từ internet chưa (năm phải lớn hơn 1970)
    if (timeInfo->tm_year < 70)
    {
        LOG_YELLOW("[Time] Thời gian hệ thống chưa được đồng bộ...");
        return;
    }

    // Tiến hành in ra Serial Monitor với định dạng đẹp
    // Lưu ý: tm_year tính từ năm 1900 nên phải cộng 1900. tm_mon tính từ 0 nên phải cộng 1.
    LOG_GREEN("[Thời gian] %02d/%02d/%04d - %02d:%02d:%02d",
              timeInfo->tm_mday,
              timeInfo->tm_mon + 1,
              timeInfo->tm_year + 1900,
              timeInfo->tm_hour,
              timeInfo->tm_min,
              timeInfo->tm_sec);
}
// Hàm phụ trợ để lấy chuỗi thời gian hiện tại theo định dạng "dd/mm/yyyy hh:mm:ss"
String lay_chuoi_thoi_gian()
{
    time_t now = time(nullptr);
    struct tm *timeInfo = localtime(&now);

    char buf[64];
    // %d: ngày, %m: tháng, %Y: năm, %H:%M:%S: giờ:phút:giây
    strftime(buf, sizeof(buf), "%d/%m/%Y %H:%M:%S", timeInfo);

    return String(buf);
}

static uint32_t last_check_stack = 0;
void kiem_tra_dung_luong_stack()
{
    if (millis() - last_check_stack > 5000)
    {
        last_check_stack = millis();

        // Kiểm tra dung lượng stack còn dư (tính bằng đơn vị 4 bytes)
        UBaseType_t stackHighWaterMark = uxTaskGetStackHighWaterMark(NULL); // NULL nghĩa là check chính task hiện tại

        // Nếu bạn muốn check task khác, hãy thay NULL bằng handler của task đó
        LOG_YELLOW("[Task Info] Stack free: %d words (x4 = %d bytes)",
                   stackHighWaterMark, stackHighWaterMark * 4);
    }
}



void hien_thi_trang_thai_control()
{
    LOG_CYAN("--- TRẠNG THÁI ĐIỀU KHIỂN HIỆN TẠI ---");
    LOG_CYAN("  [Auto Mode] : %s", FB_DATA.auto_mode ? "ON" : "OFF");
    LOG_CYAN("  [Servo Pos] : %d", FB_DATA.servo_pos);
    LOG_CYAN("  [Relay 1]   : %s", FB_DATA.relay1_btn ? "ON" : "OFF");
    LOG_CYAN("  [Relay 2]   : %s", FB_DATA.relay2_btn ? "ON" : "OFF");
    LOG_CYAN("  [Buzzer]    : %s", FB_DATA.buzzer_btn ? "ON" : "OFF");
    LOG_CYAN("--------------------------------------");
}
// Task chính để quản lý dữ liệu cảm biến và đồng bộ với Firebase
void Task_Data(void *pvParameters)
{
    esp_task_wdt_add(NULL); // Đảm bảo Task này được đăng ký với Watchdog
    LOG_GREEN("Task Data đã chạy");
    CB_Data du_lieu_nhan;

    // 1. Chờ WiFi kết nối
    LOG_YELLOW("Chờ WiFi kết nối...");
    while (WiFi.status() != WL_CONNECTED)
    {
        vTaskDelay(pdMS_TO_TICKS(500));
    }
    LOG_GREEN("WiFi đã kết nối!");
    vTaskDelay(pdMS_TO_TICKS(200));

    // 2. Khởi tạo Firebase
    LOG_CYAN("Khởi tạo Firebase...");
    khoi_tao_firebase();
    vTaskDelay(pdMS_TO_TICKS(200));

    // Chờ cấu hình thời gian thực tế thành công
    LOG_YELLOW("Chờ bộ đếm thời gian hợp lệ...");
    while (time(nullptr) < 1700000000)
    {                         // Chờ cho đến khi lấy được mốc thời gian thực tế
        esp_task_wdt_reset(); //
        vTaskDelay(pdMS_TO_TICKS(200));
        static uint32_t last_log = 0;
        if (millis() - last_log > 2000)
        {
            LOG_CYAN("...vẫn đang chờ NTP...");
            last_log = millis();
        }
    }
    LOG_GREEN("Đồng bộ thời gian thành công! Giờ hệ thống đã sẵn sàng.");

    // 3. Chờ Firebase sẵn sàng
    LOG_YELLOW("Chờ Firebase Auth sẵn sàng...");
    uint32_t timeout_start = millis();
    while (!app.ready())
    {
        app.loop(); // Phải có loop trong khi chờ
        Database.loop();
        vTaskDelay(pdMS_TO_TICKS(100));
        if (millis() - timeout_start > 30000)
        {
            LOG_RED("Timeout Firebase - bỏ qua!");
            break;
        }
    }

    firebaseReady = true;
    LOG_GREEN("Firebase sẵn sàng!");

    in_thoi_gian_hien_tai(); // In thời gian hiện tại sau khi đã đồng bộ thành công

    uint32_t lastPushFirebase_Sensor = 0;
    uint32_t lastStreamCheck = 0;
    uint32_t read_control = 0;
    static bool emailSent_Alert = false;
    while (1)
    {
        if (app.ready())
        {
            app.loop();
            Database.loop(); // 🌟 QUAN TRỌNG: Xử lý các tác vụ Database ngay tại Core 0

            // 🌟 CƠ CHẾ EVENT LISTENER: Đảm bảo stream luôn sống, thử lại mỗi 10s nếu cần
            static uint32_t last_event_check = 0;
            if (millis() - last_event_check > 10000)
            {
                last_event_check = millis();
                Database.get(*aClient_stream, "/Control", streamResult, streamCallback);
            }
        }
        // 4. Liên tục nhận dữ liệu mới nhất từ Task_Sensor
        if (xQueueReceive(xQueueData, &du_lieu_nhan, pdMS_TO_TICKS(100)) == pdPASS)
        {
            kitchenSensor = du_lieu_nhan;
        }

        hien_thi_trang_thai_control();

        uint32_t now = millis();
        if (firebaseReady && WiFi.status() == WL_CONNECTED && !isSending)
        {
            if (now - lastPushFirebase_Sensor > 10000)
            {
                lastPushFirebase_Sensor = now;
                isSending = true;
                sendSensorDataToFirebase();
            }

            if (kitchenSensor.canh_bao_chay == true && !emailSent_Alert)
            {
                LOG_RED("[HỆ THỐNG NGUY HIỂM] Đang thực hiện gửi email trực tiếp...");
                emailSent_Alert = true;

                String tieuDe = "[ALERT] Nguy Hiem Tu Kinh! (#" + String(millis() / 1000) + ")";
                String noiDung = "Canh bao khan cap!\n"
                                 "- Phat hien su co luc: " +
                                 lay_chuoi_thoi_gian() + "\n"
                                                         "- Lua phat hien: " +
                                 String(kitchenSensor.flame_detected ? "CO LUA!" : "Khong") + "\n"
                                                                                              "- Nong do Gas: " +
                                 String(kitchenSensor.gas, 1) + " PPM\n"
                                                                "- Nhiet do hien tai: " +
                                 String(kitchenSensor.temperature, 1) + " C\n"
                                                                        "He thong tu dong yeu cau kiem tra thiet bi thuc te!";

                // 🌟 1. Hủy đăng ký tạm thời Task này khỏi bộ giám sát Watchdog để tha hồ chạy ngắt quãng
                esp_task_wdt_delete(NULL);

                // Gọi hàm gửi email trực tiếp (chấp nhận mất vài giây kết nối)
                gui_email_canh_bao(tieuDe, noiDung);

                // 🌟 2. Gửi mail xong xuôi thì đăng ký lại Task vào Watchdog để bảo vệ hệ thống như cũ
                esp_task_wdt_add(NULL);
            }
            else if (kitchenSensor.canh_bao_chay == false && emailSent_Alert)
            {
                LOG_GREEN("[HỆ THỐNG AN TOÀN] Mối nguy đã được giải tỏa. Reset trạng thái cảnh báo.");
                emailSent_Alert = false; // Reset lại trạng thái để có thể gửi cảnh báo lần sau nếu cần
            }
        }

        // 🌟 QUAN TRỌNG: Reset Watchdog mỗi vòng lặp để tránh bị reboot
        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
