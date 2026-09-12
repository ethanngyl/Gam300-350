// Beginning Testing, Made sure connecting to react folder worked
// Also tested basic image uploading, but bith are not connected yet

import express from 'express'
import path, {dirname} from 'path'
import multer from 'multer'
import fs from 'fs'
import { fileURLToPath } from 'url'

const app = express()
const upload = multer({dest:'uploads/'})

const PORT = process.env.PORT || 5005

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.use(express.static(path.join(__dirname, '../web-app/dist')))

app.post('/upload', upload.array('images', 20), (req,res) =>{
    res.send('Succesfull!')
})

app.get('/', (req,res) => {
    res.sendFile(path.join(__dirname, '../web-app/dist', 'index.html'))
})

app.listen(PORT, () => console.log(`Hello World!: ${PORT}`))