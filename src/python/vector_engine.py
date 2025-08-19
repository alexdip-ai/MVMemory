#!/usr/bin/env python3
import sys
import json
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
import signal
import os
import pickle
from typing import List, Dict, Any, Optional
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class VectorEngine:
    def __init__(self, model_name: str = 'nomic-ai/nomic-embed-text-v1.5', cache_dir: str = './.cache'):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        
        try:
            self.model = SentenceTransformer(model_name, cache_folder=cache_dir)
            self.dimension = self.model.get_sentence_embedding_dimension()
            logger.info(f"Loaded model {model_name} with dimension {self.dimension}")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            self.model = SentenceTransformer('all-MiniLM-L6-v2', cache_folder=cache_dir)
            self.dimension = 384
            
        self.index = faiss.IndexFlatL2(self.dimension)
        self.id_map = faiss.IndexIDMap(self.index)
        self.metadata: Dict[int, Any] = {}
        self.next_id = 0
        
        self.load_index()
        
        signal.signal(signal.SIGTERM, self.shutdown)
        signal.signal(signal.SIGINT, self.shutdown)
        
        print(json.dumps({"type": "ready", "dimension": self.dimension}))
        sys.stdout.flush()
    
    def load_index(self):
        index_file = os.path.join(self.cache_dir, 'faiss.index')
        metadata_file = os.path.join(self.cache_dir, 'metadata.pkl')
        
        if os.path.exists(index_file) and os.path.exists(metadata_file):
            try:
                self.id_map = faiss.read_index(index_file)
                with open(metadata_file, 'rb') as f:
                    data = pickle.load(f)
                    self.metadata = data['metadata']
                    self.next_id = data['next_id']
                logger.info(f"Loaded index with {self.id_map.ntotal} vectors")
            except Exception as e:
                logger.error(f"Failed to load index: {e}")
    
    def save_index(self):
        index_file = os.path.join(self.cache_dir, 'faiss.index')
        metadata_file = os.path.join(self.cache_dir, 'metadata.pkl')
        
        try:
            faiss.write_index(self.id_map, index_file)
            with open(metadata_file, 'wb') as f:
                pickle.dump({
                    'metadata': self.metadata,
                    'next_id': self.next_id
                }, f)
            logger.info(f"Saved index with {self.id_map.ntotal} vectors")
        except Exception as e:
            logger.error(f"Failed to save index: {e}")
    
    def add_embeddings(self, texts: List[str], metadata: List[Dict]) -> Dict:
        try:
            embeddings = self.model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
            embeddings = embeddings.astype('float32')
            
            ids = []
            for i, meta in enumerate(metadata):
                vector_id = self.next_id
                self.next_id += 1
                ids.append(vector_id)
                self.metadata[vector_id] = meta
            
            ids_array = np.array(ids, dtype=np.int64)
            self.id_map.add_with_ids(embeddings, ids_array)
            
            if len(self.metadata) % 100 == 0:
                self.save_index()
            
            return {"vectorIds": ids}
        except Exception as e:
            logger.error(f"Error adding embeddings: {e}")
            return {"error": str(e)}
    
    def search(self, query: str, k: int = 10) -> List[Dict]:
        try:
            if self.id_map.ntotal == 0:
                return []
            
            query_vector = self.model.encode([query], convert_to_numpy=True, normalize_embeddings=True)
            query_vector = query_vector.astype('float32')
            
            k = min(k, self.id_map.ntotal)
            distances, indices = self.id_map.search(query_vector, k)
            
            results = []
            for idx, dist in zip(indices[0], distances[0]):
                if idx != -1 and idx in self.metadata:
                    results.append({
                        'metadata': self.metadata[idx],
                        'distance': float(dist),
                        'relevance': 1 / (1 + float(dist))
                    })
            
            return results
        except Exception as e:
            logger.error(f"Error searching: {e}")
            return []
    
    def remove_embeddings(self, vector_ids: List[int]) -> Dict:
        try:
            for vid in vector_ids:
                if vid in self.metadata:
                    del self.metadata[vid]
            
            remaining_ids = list(self.metadata.keys())
            if remaining_ids:
                vectors = []
                for vid in remaining_ids:
                    vectors.append(self.id_map.reconstruct(int(vid)))
                
                vectors = np.array(vectors, dtype='float32')
                ids = np.array(remaining_ids, dtype=np.int64)
                
                self.index = faiss.IndexFlatL2(self.dimension)
                self.id_map = faiss.IndexIDMap(self.index)
                self.id_map.add_with_ids(vectors, ids)
            else:
                self.index = faiss.IndexFlatL2(self.dimension)
                self.id_map = faiss.IndexIDMap(self.index)
            
            self.save_index()
            return {"success": True}
        except Exception as e:
            logger.error(f"Error removing embeddings: {e}")
            return {"error": str(e)}
    
    def get_stats(self) -> Dict:
        return {
            "total_vectors": self.id_map.ntotal,
            "dimension": self.dimension,
            "metadata_count": len(self.metadata)
        }
    
    def shutdown(self, signum, frame):
        logger.info("Shutting down vector engine...")
        self.save_index()
        sys.exit(0)
    
    def process_request(self, request: Dict) -> Dict:
        request_id = request.get('requestId')
        action = request.get('action')
        
        try:
            if action == 'add':
                result = self.add_embeddings(
                    request.get('texts', []),
                    request.get('metadata', [])
                )
            elif action == 'search':
                result = self.search(
                    request.get('query', ''),
                    request.get('k', 10)
                )
            elif action == 'remove':
                result = self.remove_embeddings(
                    request.get('vectorIds', [])
                )
            elif action == 'stats':
                result = self.get_stats()
            else:
                result = {"error": f"Unknown action: {action}"}
            
            return {
                "requestId": request_id,
                "result": result
            }
        except Exception as e:
            logger.error(f"Error processing request: {e}")
            return {
                "requestId": request_id,
                "error": str(e)
            }

def main():
    engine = VectorEngine()
    
    for line in sys.stdin:
        try:
            request = json.loads(line.strip())
            response = engine.process_request(request)
            print(json.dumps(response))
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")

if __name__ == '__main__':
    main()