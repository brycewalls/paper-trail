# PP-OCRv5 mobile models for the lab's OCR (#101)

The lab build's on-device OCR (`public/js/lab/ocr-worker.js`) reads pages with these two models from
PaddleOCR, run by ONNX Runtime Web. They are served by Firebase Hosting from `/lab-models/pp-ocrv5-mobile/`
on the lab site only (`firebase.json` keeps them off the live site) with a one-year immutable cache, so
a new version of any file goes in a new folder.

| File | Model | Source (pinned commit) | Size | SHA-256 |
|---|---|---|---|---|
| `det.onnx` | PP-OCRv5_mobile_det (text detection) | [PaddlePaddle/PP-OCRv5_mobile_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/tree/e6f4fa85f00e168c862bc462aebca69eef9b3d3d) `inference.onnx` | 4,826,518 bytes | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` |
| `rec-en.onnx` | en_PP-OCRv5_mobile_rec (English recognition) | [PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx](https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/tree/3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b) `inference.onnx` | 7,848,423 bytes | `b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f` |
| `dict-en.txt` | the recognizer's 436 characters, one per line | `PostProcess.character_dict` in the same repo's `inference.yml` | 1,416 bytes | |

Both are the PaddlePaddle team's own ONNX exports, published under the Apache License 2.0 (`LICENSE`,
copied from the PaddleOCR repository). Apache 2.0 allows using and redistributing them, including
in this app, with the license and this notice of where they came from.

Pre and post-processing follow each model's `inference.yml`: detection takes BGR with the ImageNet
mean and std and uses DB post-processing (threshold 0.3, box threshold 0.6, unclip 1.5); recognition
takes 48 px high crops normalized to [-1, 1], with greedy CTC decoding and a space as the last class.
See `public/js/lab/ppocr.js`.
