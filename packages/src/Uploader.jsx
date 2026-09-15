import { useRef, useState } from 'react'

const MIN_PHOTOS = 8

/**
 * Photo upload screen. Collects images (drag-drop or file picker), POSTs them to
 * the backend, and hands the new job id up to the parent via onJobCreated.
 */
export default function Uploader({ onJobCreated }) {
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  function addFiles(fileList) {
    const imgs = [...fileList].filter((f) => /^image\/(jpe?g|png)$/i.test(f.type))
    setError(null)
    setFiles((prev) => [...prev, ...imgs])
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  async function submit() {
    if (files.length < MIN_PHOTOS) {
      setError(`Add at least ${MIN_PHOTOS} photos (you have ${files.length}).`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      for (const f of files) form.append('photos', f)
      const res = await fetch('/api/jobs', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onJobCreated(data.id)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <h1>Photos → 3D model</h1>
      <p className="subtitle">
        Upload {MIN_PHOTOS}+ overlapping photos of one object or scene. More photos with
        good overlap, even lighting, and no reflections give the best result.
      </p>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        {files.length === 0 ? (
          <p>
            <strong>Drag photos here</strong> or click to browse
          </p>
        ) : (
          <p>
            <strong>{files.length}</strong> photo{files.length === 1 ? '' : 's'} selected
            <br />
            <span className="hint">click to add more</span>
          </p>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        {files.length > 0 && !submitting && (
          <button className="ghost" onClick={() => setFiles([])}>
            Clear
          </button>
        )}
        <button className="primary" onClick={submit} disabled={submitting}>
          {submitting ? 'Uploading…' : 'Create 3D model'}
        </button>
      </div>
    </div>
  )
}
