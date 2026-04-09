import { workerData, parentPort } from 'worker_threads'
import { buildZip, type BuildZipInput } from '../services/export-service.js'

export type ExportWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; zipPath: string; zipSize: number }
  | { type: 'error'; message: string }

function post(msg: ExportWorkerMessage) {
  parentPort?.postMessage(msg)
}

async function run() {
  const input = workerData as BuildZipInput & { exportId: string; exportName: string }

  try {
    const { zipPath, zipSize } = await buildZip({
      ...input,
      onProgress: (pct, msg) => post({ type: 'progress', progress: pct, message: msg }),
    })
    post({ type: 'done', zipPath, zipSize })
  } catch (err: any) {
    post({ type: 'error', message: err.message ?? String(err) })
  }
}

run()
