import Capacitor
import UIKit

@objc(UwUBatteryPlugin)
public class UwUBatteryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UwUBatteryPlugin"
    public let jsName = "UwUBattery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(
            name: "getStatus",
            returnType: CAPPluginReturnPromise
        )
    ]

    @objc public override func load() {
        super.load()

        DispatchQueue.main.async {
            UIDevice.current.isBatteryMonitoringEnabled = true

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.batteryStatusDidChange),
                name: UIDevice.batteryLevelDidChangeNotification,
                object: nil
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.batteryStatusDidChange),
                name: UIDevice.batteryStateDidChangeNotification,
                object: nil
            )
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.statusPayload())
        }
    }

    @objc private func batteryStatusDidChange() {
        notifyListeners(
            "batteryStatusChanged",
            data: statusPayload()
        )
    }

    private func statusPayload() -> JSObject {
        let device = UIDevice.current
        let rawLevel = device.batteryLevel
        let level = rawLevel >= 0
            ? Int((rawLevel * 100).rounded())
            : -1
        let state: String

        switch device.batteryState {
        case .unplugged:
            state = "unplugged"
        case .charging:
            state = "charging"
        case .full:
            state = "full"
        case .unknown:
            fallthrough
        @unknown default:
            state = "unknown"
        }

        return [
            "level": level,
            "state": state,
            "charging": state == "charging" || state == "full",
            "timestampMs": Int(
                Date().timeIntervalSince1970 * 1000
            )
        ]
    }
}

final class UwUBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(UwUBatteryPlugin())

        // iPad uses UITextInputAssistantItem for the shortcuts row.
        // iPhone is handled by Capacitor Keyboard's
        // setAccessoryBarVisible(false) from the web bootstrap.
        webView?.inputAssistantItem.leadingBarButtonGroups = []
        webView?.inputAssistantItem.trailingBarButtonGroups = []
    }
}
