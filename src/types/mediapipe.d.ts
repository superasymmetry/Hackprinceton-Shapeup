// Global type declarations for MediaPipe loaded via CDN script injection.
// These are not imported — they exist on window after the scripts load.

declare global {
  interface Window {
    FaceMesh: new (config: { locateFile: (file: string) => string }) => MediaPipeFaceMesh;
    SelfieSegmentation: new (config: { locateFile: (file: string) => string }) => MediaPipeSelfieSegmentation;
  }

  interface MediaPipeFaceMesh {
    setOptions(options: {
      maxNumFaces?: number;
      refineLandmarks?: boolean;
      minDetectionConfidence?: number;
      minTrackingConfidence?: number;
    }): void;
    onResults(callback: (results: FaceMeshResults) => void): void;
    send(input: { image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement }): Promise<void>;
    close(): void;
  }

  interface FaceMeshResults {
    multiFaceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
  }

  interface MediaPipeSelfieSegmentation {
    setOptions(options: { modelSelection?: number }): void;
    onResults(callback: (results: SegmentationResults) => void): void;
    send(input: { image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement }): Promise<void>;
    close(): void;
  }

  interface SegmentationResults {
    segmentationMask: ImageBitmap | HTMLCanvasElement;
  }
}

export {};
