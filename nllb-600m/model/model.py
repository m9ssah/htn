import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

class Model:
    def __init__(self, **kwargs):
        self._model = None
        self._tokenizer = None

    def load(self):
        # Load the distilled 600M parameter model variant
        model_id = "facebook/nllb-200-distilled-600M"
        
        self._tokenizer = AutoTokenizer.from_pretrained(model_id)
        self._model = AutoModelForSeq2SeqLM.from_pretrained(
            model_id, 
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32
        )
        
        if torch.cuda.is_available():
            self._model.to("cuda")

    def predict(self, model_input):
        """
        Expected input format:
        {
            "text": "Hello world",
            "src_lang": "eng_Latn",
            "tgt_lang": "fra_Latn"
        }
        """
        text = model_input.get("text")
        src_lang = model_input.get("src_lang", "eng_Latn")
        tgt_lang = model_input.get("tgt_lang", "fra_Latn")
        
        if not text:
            return {"error": "Missing 'text' parameter in input payload."}

        # Set the source language on the tokenizer
        self._tokenizer.src_lang = src_lang
        
        # Tokenize inputs
        inputs = self._tokenizer(text, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.to("cuda") for k, v in inputs.items()}
            
        # Generate translation tokens targeting the specified language
        forced_bos_token_id = self._tokenizer.lang_code_to_id[tgt_lang]
        
        with torch.no_grad():
            translated_tokens = self._model.generate(
                **inputs, 
                forced_bos_token_id=forced_bos_token_id, 
                max_length=256
            )
            
        # Decode output
        result = self._tokenizer.batch_decode(translated_tokens, skip_special_tokens=True)[0]
        
        return {"translation": result}
