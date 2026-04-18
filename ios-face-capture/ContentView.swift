// ============================================================
// FaceCapture — ARKit TrueDepth face mesh → ShapeUp web app
//
// Setup:
//   1. Create a new Xcode iOS App project (SwiftUI, iOS 16+)
//   2. Replace ContentView.swift with this file
//   3. Add NSCameraUsageDescription to Info.plist
//      Key:   Privacy - Camera Usage Description
//      Value: Used to capture your face mesh
//   4. Set MAC_IP below to your Mac's local IP (System Settings → Wi-Fi → Details)
//   5. Run on your iPhone (not Simulator — TrueDepth not available in Simulator)
// ============================================================

import SwiftUI
import ARKit
import RealityKit

// ── Config ────────────────────────────────────────────────────
// Your Mac's local IP address. Run `ipconfig getifaddr en0` in Terminal to find it.
let MAC_IP = "10.37.112.80"   // ← change this
let MAC_PORT = 3000

// ── AR Session coordinator ────────────────────────────────────

class FaceCaptureCoordinator: NSObject, ARSessionDelegate {
  var session: ARSession
  var onCapture: ((Result<String, Error>) -> Void)?

  override init() {
    session = ARSession()
    super.init()
    session.delegate = self
  }

  func start() {
    guard ARFaceTrackingConfiguration.isSupported else { return }
    let config = ARFaceTrackingConfiguration()
    session.run(config)
  }

  func stop() {
    session.pause()
  }

  // Grab the current frame's face geometry and POST it to the Mac.
  func capture() {
    guard let frame = session.currentFrame,
          let anchor = frame.anchors.compactMap({ $0 as? ARFaceAnchor }).first
    else {
      onCapture?(.failure(CaptureError.noFaceDetected))
      return
    }

    let geo = anchor.geometry

    // Convert SCNVector3 buffer → [[x,y,z]] array
    let vertices: [[Float]] = (0..<geo.vertices.count).map { i in
      let v = geo.vertices[i]
      return [v.x, v.y, v.z]
    }

    // Triangle indices → [[i0,i1,i2]]
    let indexBuffer = geo.triangleIndices
    var indices: [[Int16]] = []
    let triCount = geo.triangleCount
    for t in 0..<triCount {
      let base = t * 3
      indices.append([indexBuffer[base], indexBuffer[base+1], indexBuffer[base+2]])
    }

    let payload: [String: Any] = [
      "vertices": vertices,
      "indices":  indices,
    ]

    guard let url = URL(string: "http://\(MAC_IP):\(MAC_PORT)/api/face-mesh") else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")

    do {
      req.httpBody = try JSONSerialization.data(withJSONObject: payload)
    } catch {
      onCapture?(.failure(error))
      return
    }

    URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
      DispatchQueue.main.async {
        if let error = error {
          self?.onCapture?(.failure(error))
          return
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 200 {
          self?.onCapture?(.success("Sent \(vertices.count) vertices"))
        } else {
          self?.onCapture?(.failure(CaptureError.badResponse(code)))
        }
      }
    }.resume()
  }

  enum CaptureError: LocalizedError {
    case noFaceDetected
    case badResponse(Int)
    var errorDescription: String? {
      switch self {
      case .noFaceDetected: return "No face detected — look at the front camera"
      case .badResponse(let code): return "Server returned \(code)"
      }
    }
  }
}

// ── SwiftUI View ──────────────────────────────────────────────

struct ContentView: View {
  @StateObject private var vm = FaceCaptureVM()

  var body: some View {
    ZStack {
      ARViewContainer(coordinator: vm.coordinator)
        .ignoresSafeArea()

      VStack {
        Spacer()

        if let msg = vm.statusMessage {
          Text(msg)
            .padding(10)
            .background(.black.opacity(0.6))
            .foregroundColor(.white)
            .cornerRadius(8)
            .padding(.bottom, 16)
        }

        Button(action: vm.capture) {
          Label(vm.isCapturing ? "Sending…" : "Capture Face", systemImage: "face.smiling")
            .font(.title2.bold())
            .padding(.horizontal, 32)
            .padding(.vertical, 14)
            .background(vm.isCapturing ? Color.gray : Color.blue)
            .foregroundColor(.white)
            .cornerRadius(14)
        }
        .disabled(vm.isCapturing)
        .padding(.bottom, 48)
      }
    }
    .onAppear { vm.coordinator.start() }
    .onDisappear { vm.coordinator.stop() }
  }
}

class FaceCaptureVM: ObservableObject {
  let coordinator = FaceCaptureCoordinator()
  @Published var statusMessage: String?
  @Published var isCapturing = false

  init() {
    coordinator.onCapture = { [weak self] result in
      // already dispatched to main in coordinator
      self?.isCapturing = false
      switch result {
      case .success(let msg):
        self?.statusMessage = "✓ " + msg + "\nOpen ShapeUp on your Mac to see the result."
      case .failure(let err):
        self?.statusMessage = "✗ " + err.localizedDescription
      }
    }
  }

  func capture() {
    isCapturing = true
    statusMessage = "Capturing…"
    coordinator.capture()
  }
}

// ── ARView wrapper ─────────────────────────────────────────────

struct ARViewContainer: UIViewRepresentable {
  let coordinator: FaceCaptureCoordinator

  func makeUIView(context: Context) -> ARView {
    let arView = ARView(frame: .zero)
    arView.session = coordinator.session
    return arView
  }

  func updateUIView(_ uiView: ARView, context: Context) {}
}
