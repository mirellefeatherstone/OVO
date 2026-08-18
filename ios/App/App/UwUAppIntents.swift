import AppIntents
import Foundation


// =========================================================
// App 活动类型
// =========================================================

enum AppActivityAction: String, AppEnum {

    case open
    case close

    static let typeDisplayRepresentation =
        TypeDisplayRepresentation(name: "App 活动")

    static let caseDisplayRepresentations: [AppActivityAction: DisplayRepresentation] = [
        .open: "打开",
        .close: "关闭"
    ]
}


// =========================================================
// 记录 App 活动
// =========================================================

struct LogAppActivityIntent: AppIntent {

    static let title: LocalizedStringResource =
        "记录 App 活动"

    static let description = IntentDescription(
        "记录某个 App 的打开或关闭事件，供 UwU 计算使用时长。"
    )

    static let supportedModes: IntentModes = [.background]


    @Parameter(title: "App 名称")
    var appName: String


    @Parameter(title: "动作")
    var action: AppActivityAction


    static var parameterSummary: some ParameterSummary {
        Summary(
            "记录 \(\.$appName) \(\.$action)"
        )
    }


    func perform() async throws -> some IntentResult {

        // ---------- 时间 ----------

        let now = Date()

        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current

        let localTime =
            formatter.string(from: now)


        // ---------- 记录 ----------

        let record: [String: Any] = [
            "appName": appName,
            "action": action.rawValue,
            "timestamp": localTime,
            "timestampMs":
                Int64(now.timeIntervalSince1970 * 1000)
        ]


        let jsonData = try JSONSerialization.data(
            withJSONObject: record,
            options: []
        )

        guard let jsonLine = String(
            data: jsonData,
            encoding: .utf8
        ) else {
            throw NSError(
                domain: "UwUAppIntent",
                code: 1
            )
        }


        // ---------- Documents/UwU Data ----------

        let fileManager =
            FileManager.default

        let documentsURL =
            fileManager.urls(
                for: .documentDirectory,
                in: .userDomainMask
            )[0]

        let folderURL =
            documentsURL.appendingPathComponent(
                "UwU Data",
                isDirectory: true
            )

        try fileManager.createDirectory(
            at: folderURL,
            withIntermediateDirectories: true
        )

        let fileURL =
            folderURL.appendingPathComponent(
                "app_usage_log.jsonl"
            )


        // ---------- 追加一行 ----------

        let lineData =
            Data((jsonLine + "\n").utf8)

        if fileManager.fileExists(
            atPath: fileURL.path
        ) {

            let handle = try FileHandle(
                forWritingTo: fileURL
            )

            try handle.seekToEnd()
            try handle.write(
                contentsOf: lineData
            )

            try handle.close()

        } else {

            try lineData.write(
                to: fileURL,
                options: .atomic
            )
        }


        print(
            "[UwU Intent] \(appName) \(action.rawValue) @ \(localTime)"
        )

        return .result()
    }
}


// =========================================================
// 暴露给快捷指令
// =========================================================

struct UwUAppShortcuts: AppShortcutsProvider {

    static var appShortcuts: [AppShortcut] {

        AppShortcut(
            intent: LogAppActivityIntent(),
            phrases: [
                "用 \(.applicationName) 记录 App 活动"
            ],
            shortTitle: "记录 App 活动",
            systemImageName: "iphone"
        )
    }
}
