import io
import cv2
import numpy as np
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException
from paddleocr import PaddleOCR

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Tchedes PaddleOCR Service")

# Initialize PaddleOCR globally so it's loaded into RAM once when the app starts
# use_angle_cls=True allows it to automatically detect text orientation
# lang='fr' is optimal for Cameroon ID cards which are mostly in French (also detects English well)
logger.info("Initializing PaddleOCR model. This might take a moment on first boot...")
try:
    ocr_model = PaddleOCR(use_angle_cls=True, lang='fr', show_log=False)
    logger.info("PaddleOCR model loaded successfully.")
except Exception as e:
    logger.error(f"Failed to load PaddleOCR model: {e}")
    ocr_model = None

@app.get("/health")
def health_check():
    return {
        "status": "ok", 
        "ocr_model_loaded": ocr_model is not None,
        "engine": "paddleocr"
    }

@app.post("/extract")
async def extract_text(file: UploadFile = File(...)):
    """
    Receives an image file via multipart/form-data.
    Runs PaddleOCR inference on it.
    Returns the concatenated raw text ready for Regex Parsing.
    """
    if not ocr_model:
        raise HTTPException(status_code=500, detail="OCR engine is not initialized.")
        
    try:
        # 1. Read the image bytes directly from the request
        contents = await file.read()
        
        # 2. Convert bytes to a numpy array for OpenCV
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file provided.")
            
        logger.info(f"Processing image: {file.filename} (shape: {img.shape})")
        
        # 3. Run PaddleOCR Inference
        # result is a list containing detection boxes and text.
        # Format: [[[[x,y],[x,y],[x,y],[x,y]], ('text', confidence)], ...]
        result = ocr_model.ocr(img, cls=True)
        
        # 4. Extract and concatenate the raw text
        raw_text_lines = []
        if result and len(result) > 0 and result[0] is not None:
             for line in result[0]:
                 text = line[1][0]
                 raw_text_lines.append(text)
                 
        raw_text = "\n".join(raw_text_lines)
        
        logger.info(f"Successfully extracted {len(raw_text_lines)} lines of text.")
        
        return {
            "raw_text": raw_text,
            "engine": "paddleocr"
        }
        
    except Exception as e:
        logger.error(f"OCR Extraction Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
