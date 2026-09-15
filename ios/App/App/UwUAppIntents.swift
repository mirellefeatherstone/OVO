import AppIntents
import Foundation


enum AppUsageLogStore {

    private static func fileURL() throws -> URL {
        let documentsURL = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0]
        let folderURL = documentsURL.appendingPathComponent(
            "UwU Data",
            isDirectory: true
        )

        try FileManager.default.createDirectory(
            at: folderURL,
            withIntermediateDirectories: true
        )

        let url = folderURL.appendingPathComponent("app_usage_log.jsonl")
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        return url
    }

    private static func withCoordinatedFile<T>(
        _ body: (URL) throws -> T
    ) throws -> T {
        let url = try fileURL()
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinationError: NSError?
        var result: Result<T, Error>?

        coordinator.coordinate(
            writingItemAt: url,
            options: [],
            error: &coordinationError
        ) { coordinatedURL in
            result = Result {
                try body(coordinatedURL)
            }
        }

        if let coordinationError {
            throw coordinationError
        }
        guard let result else {
            throw CocoaError(.fileWriteUnknown)
        }
        return try result.get()
    }

    static func append(_ data: Data) throws {
        try withCoordinatedFile { url in
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.synchronize()
        }
    }

    static func repairMalformedLines() throws -> Int {
        try withCoordinatedFile { url in
            let handle = try FileHandle(forUpdating: url)
            defer { try? handle.close() }
            try handle.seek(toOffset: 0)
            let data = try handle.readToEnd() ?? Data()
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else {
                return 0
            }

            let lines = text
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map(String.init)
            let validLines = lines.filter { line in
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return false }
                return (try? JSONSerialization.jsonObject(with: Data(trimmed.utf8))) != nil
            }
            let nonemptyCount = lines.reduce(into: 0) { count, line in
                if !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    count += 1
                }
            }
            let malformedCount = nonemptyCount - validLines.count
            guard malformedCount > 0 else { return 0 }

            let repaired = Data((validLines.joined(separator: "\n") + "\n").utf8)
            try handle.truncate(atOffset: 0)
            try handle.seek(toOffset: 0)
            try handle.write(contentsOf: repaired)
            try handle.synchronize()
            return malformedCount
        }
    }
}


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

        // ---------- 追加一行 ----------

        let lineData =
            Data((jsonLine + "\n").utf8)

        try AppUsageLogStore.append(lineData)


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
