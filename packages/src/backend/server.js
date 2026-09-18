// Beginning Testing, Made sure connecting to react folder worked
// Also tested basic image uploading, but bith are not connected yet

import express from 'express'
import path, {dirname} from 'path'
import multer from 'multer'
import fs from 'fs'
import { fileURLToPath } from 'url'

const app = express()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BASE_UPLOAD_DIR = path.join(__dirname, '/uploads')

function makeOneFolder (req,file,next) {
    // Create a unique folder name using the current timestamp and a random number
    const uniqueFolderName = `${Date.now()}-${Math.round(Math.random() * 1E9)}`
    const targetDir = path.join(BASE_UPLOAD_DIR, uniqueFolderName)

    // Ensure the target directory exists (creates it if it doesn't)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    req.batchDir = targetDir
    next()
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {

    // Pass the directory path to the callback
    cb(null, req.batchDir);
    //cb(null, 'uploads/') // Make sure this folder exists
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  }
});

async function onlyImages(req, res, next) {
    if (!req.files || req.files.length === 0) return next();

    try{
        const {fileTypeFromBuffer} = await import('file-type')
        const legalMimes = ['image/jpeg', 'image/png']

        // Delete illegal files
        for (const file of req.files) {
            const buffer = fs.readFileSync(file.path)
            const type = await fileTypeFromBuffer(buffer)

            if (!type || !legalMimes.includes(type.mime)) {
                // clean up every file already written for this batch
                req.files.forEach(f => {if (fs.existsSync(f.path)) fs.unlinkSync(f.path)})    
                return res.status(400).json ({
                    error: 'invalid file content',
                    detected: type ? type.mime : 'unknown'
                })
            }
        }
        
        next()
    }
    catch (error) {
        next(error)
    }
}

const upload = multer({storage : storage})

const PORT = process.env.PORT || 5005

app.use(express.static(path.join(__dirname, '../web-app/dist')))

app.post('/upload', makeOneFolder, upload.array('images', 20), onlyImages, (req,res) => {
    res.json({
        message: 'File uploaded successfully!',
        count: req.files.length,
        files: req.files.map(f => ({name: f.originalname, path: f.path}))
    })
})

app.get('/', (req,res) => {
    res.sendFile(path.join(__dirname, '../web-app/dist', 'index.html'))
})

app.use(express.static('uploads'))
app.use('/uploads',express.static('uploads'))

app.listen(PORT, () => console.log(`Hello World!: ${PORT}`))