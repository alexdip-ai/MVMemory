#!/usr/bin/env python3
"""
Comprehensive unit tests for the VectorEngine module.
Tests cover functionality, edge cases, error handling, and performance.
"""

import unittest
import tempfile
import shutil
import json
import pickle
import os
import sys
import numpy as np
from unittest.mock import Mock, patch, MagicMock
import threading
import time
from io import StringIO

# Import the module under test
sys.path.insert(0, os.path.dirname(__file__))
from vector_engine import VectorEngine


class TestVectorEngine(unittest.TestCase):
    """Test suite for VectorEngine class."""
    
    def setUp(self):
        """Set up test fixtures before each test method."""
        self.temp_dir = tempfile.mkdtemp()
        self.engine = None
        
    def tearDown(self):
        """Clean up after each test method."""
        if self.engine:
            try:
                del self.engine
            except:
                pass
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def create_test_engine(self, model_name='all-MiniLM-L6-v2'):
        """Create a test engine with mocked output."""
        with patch('sys.stdout', new=StringIO()):
            self.engine = VectorEngine(model_name=model_name, cache_dir=self.temp_dir)
        return self.engine


class TestInitialization(TestVectorEngine):
    """Test VectorEngine initialization."""
    
    def test_basic_initialization(self):
        """Test basic engine initialization."""
        engine = self.create_test_engine()
        
        self.assertIsNotNone(engine.model)
        self.assertIsNotNone(engine.index)
        self.assertIsNotNone(engine.id_map)
        self.assertEqual(engine.dimension, 384)  # all-MiniLM-L6-v2 dimension
        self.assertEqual(engine.next_id, 0)
        self.assertEqual(len(engine.metadata), 0)
    
    def test_initialization_with_custom_model(self):
        """Test initialization with custom model name."""
        engine = self.create_test_engine('sentence-transformers/all-mpnet-base-v2')
        
        self.assertIsNotNone(engine.model)
        # Should fall back to default if custom model fails
        self.assertEqual(engine.dimension, 384)
    
    def test_initialization_with_custom_cache_dir(self):
        """Test initialization with custom cache directory."""
        custom_dir = os.path.join(self.temp_dir, 'custom_cache')
        
        with patch('sys.stdout', new=StringIO()):
            engine = VectorEngine(cache_dir=custom_dir)
        
        self.assertTrue(os.path.exists(custom_dir))
        self.assertEqual(engine.cache_dir, custom_dir)
        del engine
    
    @patch('vector_engine.SentenceTransformer')
    def test_model_loading_fallback(self, mock_transformer):
        """Test fallback when primary model fails to load."""
        # Mock the first model to fail, second to succeed
        mock_transformer.side_effect = [Exception("Model not found"), Mock()]
        mock_transformer.return_value.get_sentence_embedding_dimension.return_value = 384
        
        with patch('sys.stdout', new=StringIO()):
            engine = VectorEngine(model_name='non-existent-model', cache_dir=self.temp_dir)
        
        # Should have been called twice (first fails, second succeeds)
        self.assertEqual(mock_transformer.call_count, 2)
        del engine


class TestEmbeddingOperations(TestVectorEngine):
    """Test embedding addition and removal operations."""
    
    def setUp(self):
        super().setUp()
        self.engine = self.create_test_engine()
    
    def test_add_single_embedding(self):
        """Test adding a single embedding."""
        texts = ["This is a test document"]
        metadata = [{"id": "doc1", "type": "test"}]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), 1)
        self.assertEqual(result["vectorIds"][0], 0)
        self.assertEqual(self.engine.next_id, 1)
        self.assertEqual(len(self.engine.metadata), 1)
    
    def test_add_multiple_embeddings(self):
        """Test adding multiple embeddings."""
        texts = [
            "First document about programming",
            "Second document about cooking",
            "Third document about travel"
        ]
        metadata = [
            {"id": "doc1", "topic": "programming"},
            {"id": "doc2", "topic": "cooking"},
            {"id": "doc3", "topic": "travel"}
        ]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), 3)
        self.assertEqual(result["vectorIds"], [0, 1, 2])
        self.assertEqual(self.engine.next_id, 3)
        self.assertEqual(len(self.engine.metadata), 3)
    
    def test_add_empty_texts(self):
        """Test adding empty text list."""
        result = self.engine.add_embeddings([], [])
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), 0)
        self.assertEqual(self.engine.next_id, 0)
    
    def test_add_embeddings_with_special_characters(self):
        """Test adding embeddings with special characters."""
        texts = [
            "Text with émojis 🎉 and unicode 测试",
            "Text with symbols !@#$%^&*()",
            "Text with newlines\nand\ttabs"
        ]
        metadata = [
            {"content": "unicode"},
            {"content": "symbols"},
            {"content": "whitespace"}
        ]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), 3)
    
    def test_add_very_long_text(self):
        """Test adding very long text."""
        long_text = "This is a very long document. " * 1000
        texts = [long_text]
        metadata = [{"id": "long_doc"}]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), 1)
    
    @patch('vector_engine.VectorEngine.model')
    def test_add_embeddings_error_handling(self, mock_model):
        """Test error handling during embedding addition."""
        mock_model.encode.side_effect = Exception("Encoding failed")
        
        result = self.engine.add_embeddings(["test"], [{"id": "test"}])
        
        self.assertIn("error", result)
        self.assertIn("Encoding failed", result["error"])
    
    def test_remove_existing_embeddings(self):
        """Test removing existing embeddings."""
        # Add some embeddings first
        texts = ["Doc 1", "Doc 2", "Doc 3"]
        metadata = [{"id": f"doc{i}"} for i in range(3)]
        add_result = self.engine.add_embeddings(texts, metadata)
        
        # Remove middle embedding
        vector_ids = [1]
        result = self.engine.remove_embeddings(vector_ids)
        
        self.assertTrue(result.get("success"))
        self.assertNotIn(1, self.engine.metadata)
        self.assertIn(0, self.engine.metadata)
        self.assertIn(2, self.engine.metadata)
    
    def test_remove_nonexistent_embeddings(self):
        """Test removing non-existent embeddings."""
        result = self.engine.remove_embeddings([999])
        
        self.assertTrue(result.get("success"))
    
    def test_remove_all_embeddings(self):
        """Test removing all embeddings."""
        # Add some embeddings
        texts = ["Doc 1", "Doc 2"]
        metadata = [{"id": "doc1"}, {"id": "doc2"}]
        add_result = self.engine.add_embeddings(texts, metadata)
        
        # Remove all
        vector_ids = add_result["vectorIds"]
        result = self.engine.remove_embeddings(vector_ids)
        
        self.assertTrue(result.get("success"))
        self.assertEqual(len(self.engine.metadata), 0)
        self.assertEqual(self.engine.id_map.ntotal, 0)
    
    @patch('vector_engine.VectorEngine.id_map')
    def test_remove_embeddings_error_handling(self, mock_id_map):
        """Test error handling during embedding removal."""
        mock_id_map.reconstruct.side_effect = Exception("Reconstruction failed")
        
        # Add an embedding first
        self.engine.metadata[0] = {"id": "test"}
        
        result = self.engine.remove_embeddings([0])
        
        self.assertIn("error", result)


class TestSearchOperations(TestVectorEngine):
    """Test search functionality."""
    
    def setUp(self):
        super().setUp()
        self.engine = self.create_test_engine()
        
        # Add some test data
        self.test_texts = [
            "Python programming language tutorial",
            "Machine learning with neural networks",
            "Cooking recipe for pasta",
            "Travel guide to Paris France",
            "Data science and analytics"
        ]
        self.test_metadata = [
            {"id": "doc1", "topic": "programming", "language": "python"},
            {"id": "doc2", "topic": "ml", "category": "technology"},
            {"id": "doc3", "topic": "cooking", "category": "food"},
            {"id": "doc4", "topic": "travel", "category": "lifestyle"},
            {"id": "doc5", "topic": "data", "category": "technology"}
        ]
        
        self.engine.add_embeddings(self.test_texts, self.test_metadata)
    
    def test_basic_search(self):
        """Test basic search functionality."""
        results = self.engine.search("programming", k=3)
        
        self.assertIsInstance(results, list)
        self.assertLessEqual(len(results), 3)
        
        if results:
            result = results[0]
            self.assertIn("metadata", result)
            self.assertIn("distance", result)
            self.assertIn("relevance", result)
            self.assertIsInstance(result["distance"], float)
            self.assertIsInstance(result["relevance"], float)
    
    def test_search_with_exact_match(self):
        """Test search with text that should match exactly."""
        results = self.engine.search("Python programming language tutorial", k=1)
        
        self.assertGreater(len(results), 0)
        # Should have high relevance for exact match
        self.assertGreater(results[0]["relevance"], 0.8)
    
    def test_search_empty_index(self):
        """Test search on empty index."""
        empty_engine = self.create_test_engine()
        results = empty_engine.search("test query")
        
        self.assertEqual(results, [])
        del empty_engine
    
    def test_search_with_different_k_values(self):
        """Test search with different k values."""
        query = "technology"
        
        # Test k=1
        results_1 = self.engine.search(query, k=1)
        self.assertLessEqual(len(results_1), 1)
        
        # Test k=3
        results_3 = self.engine.search(query, k=3)
        self.assertLessEqual(len(results_3), 3)
        
        # Test k larger than available documents
        results_large = self.engine.search(query, k=100)
        self.assertLessEqual(len(results_large), 5)  # We only have 5 documents
    
    def test_search_with_k_zero(self):
        """Test search with k=0."""
        results = self.engine.search("test", k=0)
        self.assertEqual(len(results), 0)
    
    def test_search_empty_query(self):
        """Test search with empty query."""
        results = self.engine.search("", k=5)
        
        # Should still return results, though they may not be meaningful
        self.assertIsInstance(results, list)
    
    def test_search_special_characters(self):
        """Test search with special characters."""
        queries = [
            "🎉 émojis",
            "symbols !@#$%",
            "unicode 测试",
            "newlines\nand\ttabs"
        ]
        
        for query in queries:
            results = self.engine.search(query, k=3)
            self.assertIsInstance(results, list)
    
    def test_search_very_long_query(self):
        """Test search with very long query."""
        long_query = "This is a very long query with many words. " * 100
        results = self.engine.search(long_query, k=3)
        
        self.assertIsInstance(results, list)
    
    @patch('vector_engine.VectorEngine.model')
    def test_search_error_handling(self, mock_model):
        """Test error handling during search."""
        mock_model.encode.side_effect = Exception("Encoding failed")
        
        results = self.engine.search("test query")
        
        self.assertEqual(results, [])
    
    def test_search_relevance_calculation(self):
        """Test that relevance scores are calculated correctly."""
        results = self.engine.search("programming", k=5)
        
        if len(results) > 1:
            # Check that relevance scores are in descending order
            for i in range(len(results) - 1):
                self.assertGreaterEqual(results[i]["relevance"], results[i + 1]["relevance"])
        
        # Check that relevance is between 0 and 1
        for result in results:
            self.assertGreaterEqual(result["relevance"], 0)
            self.assertLessEqual(result["relevance"], 1)


class TestPersistence(TestVectorEngine):
    """Test index saving and loading functionality."""
    
    def test_save_and_load_empty_index(self):
        """Test saving and loading empty index."""
        engine = self.create_test_engine()
        
        # Save empty index
        engine.save_index()
        
        # Check files exist
        index_file = os.path.join(self.temp_dir, 'faiss.index')
        metadata_file = os.path.join(self.temp_dir, 'metadata.pkl')
        
        self.assertTrue(os.path.exists(index_file))
        self.assertTrue(os.path.exists(metadata_file))
        
        # Create new engine and load
        engine2 = self.create_test_engine()
        self.assertEqual(engine2.id_map.ntotal, 0)
        self.assertEqual(len(engine2.metadata), 0)
        
        del engine, engine2
    
    def test_save_and_load_with_data(self):
        """Test saving and loading index with data."""
        engine = self.create_test_engine()
        
        # Add some data
        texts = ["Document 1", "Document 2", "Document 3"]
        metadata = [{"id": f"doc{i}"} for i in range(3)]
        add_result = engine.add_embeddings(texts, metadata)
        
        # Save index
        engine.save_index()
        
        # Create new engine and verify data is loaded
        engine2 = self.create_test_engine()
        
        self.assertEqual(engine2.id_map.ntotal, 3)
        self.assertEqual(len(engine2.metadata), 3)
        self.assertEqual(engine2.next_id, 3)
        
        # Test search works
        results = engine2.search("Document", k=3)
        self.assertEqual(len(results), 3)
        
        del engine, engine2
    
    def test_load_corrupted_index(self):
        """Test loading corrupted index files."""
        engine = self.create_test_engine()
        
        # Create corrupted files
        index_file = os.path.join(self.temp_dir, 'faiss.index')
        metadata_file = os.path.join(self.temp_dir, 'metadata.pkl')
        
        with open(index_file, 'w') as f:
            f.write("corrupted data")
        with open(metadata_file, 'wb') as f:
            f.write(b"corrupted pickle data")
        
        # Should handle gracefully and start with empty index
        engine2 = self.create_test_engine()
        self.assertEqual(engine2.id_map.ntotal, 0)
        
        del engine, engine2
    
    def test_automatic_save_on_bulk_add(self):
        """Test automatic saving after bulk operations."""
        engine = self.create_test_engine()
        
        # Add exactly 100 documents to trigger auto-save
        texts = [f"Document {i}" for i in range(100)]
        metadata = [{"id": f"doc{i}"} for i in range(100)]
        
        engine.add_embeddings(texts, metadata)
        
        # Check that files were created
        index_file = os.path.join(self.temp_dir, 'faiss.index')
        metadata_file = os.path.join(self.temp_dir, 'metadata.pkl')
        
        self.assertTrue(os.path.exists(index_file))
        self.assertTrue(os.path.exists(metadata_file))
        
        del engine
    
    @patch('vector_engine.faiss.write_index')
    def test_save_error_handling(self, mock_write):
        """Test error handling during save operations."""
        mock_write.side_effect = Exception("Save failed")
        
        engine = self.create_test_engine()
        
        # Should not crash on save error
        engine.save_index()
        
        del engine
    
    @patch('vector_engine.faiss.read_index')
    def test_load_error_handling(self, mock_read):
        """Test error handling during load operations."""
        mock_read.side_effect = Exception("Load failed")
        
        # Create valid-looking files
        index_file = os.path.join(self.temp_dir, 'faiss.index')
        metadata_file = os.path.join(self.temp_dir, 'metadata.pkl')
        
        with open(index_file, 'w') as f:
            f.write("dummy")
        with open(metadata_file, 'wb') as f:
            pickle.dump({"metadata": {}, "next_id": 0}, f)
        
        # Should handle load error gracefully
        engine = self.create_test_engine()
        self.assertEqual(engine.id_map.ntotal, 0)
        
        del engine


class TestRequestProcessing(TestVectorEngine):
    """Test request processing functionality."""
    
    def setUp(self):
        super().setUp()
        self.engine = self.create_test_engine()
    
    def test_add_request(self):
        """Test processing add request."""
        request = {
            "requestId": "test_req_1",
            "action": "add",
            "texts": ["Test document"],
            "metadata": [{"id": "test"}]
        }
        
        response = self.engine.process_request(request)
        
        self.assertEqual(response["requestId"], "test_req_1")
        self.assertIn("result", response)
        self.assertIn("vectorIds", response["result"])
    
    def test_search_request(self):
        """Test processing search request."""
        # Add some data first
        self.engine.add_embeddings(["Test document"], [{"id": "test"}])
        
        request = {
            "requestId": "test_req_2",
            "action": "search",
            "query": "test",
            "k": 5
        }
        
        response = self.engine.process_request(request)
        
        self.assertEqual(response["requestId"], "test_req_2")
        self.assertIn("result", response)
        self.assertIsInstance(response["result"], list)
    
    def test_remove_request(self):
        """Test processing remove request."""
        # Add data first
        add_result = self.engine.add_embeddings(["Test document"], [{"id": "test"}])
        vector_id = add_result["vectorIds"][0]
        
        request = {
            "requestId": "test_req_3",
            "action": "remove",
            "vectorIds": [vector_id]
        }
        
        response = self.engine.process_request(request)
        
        self.assertEqual(response["requestId"], "test_req_3")
        self.assertIn("result", response)
        self.assertTrue(response["result"].get("success"))
    
    def test_stats_request(self):
        """Test processing stats request."""
        request = {
            "requestId": "test_req_4",
            "action": "stats"
        }
        
        response = self.engine.process_request(request)
        
        self.assertEqual(response["requestId"], "test_req_4")
        self.assertIn("result", response)
        self.assertIn("total_vectors", response["result"])
        self.assertIn("dimension", response["result"])
        self.assertIn("metadata_count", response["result"])
    
    def test_unknown_action(self):
        """Test processing request with unknown action."""
        request = {
            "requestId": "test_req_5",
            "action": "unknown_action"
        }
        
        response = self.engine.process_request(request)
        
        self.assertEqual(response["requestId"], "test_req_5")
        self.assertIn("result", response)
        self.assertIn("error", response["result"])
        self.assertIn("Unknown action", response["result"]["error"])
    
    def test_request_without_id(self):
        """Test processing request without request ID."""
        request = {
            "action": "stats"
        }
        
        response = self.engine.process_request(request)
        
        self.assertIsNone(response["requestId"])
        self.assertIn("result", response)
    
    def test_malformed_request(self):
        """Test processing malformed request."""
        request = {
            "requestId": "test_req_6",
            "action": "add"
            # Missing required fields
        }
        
        response = self.engine.process_request(request)
        
        self.assertEqual(response["requestId"], "test_req_6")
        # Should handle gracefully, possibly with empty results
        self.assertIn("result", response)
    
    def test_request_processing_error(self):
        """Test error handling in request processing."""
        with patch.object(self.engine, 'add_embeddings', side_effect=Exception("Test error")):
            request = {
                "requestId": "test_req_7",
                "action": "add",
                "texts": ["test"],
                "metadata": [{"id": "test"}]
            }
            
            response = self.engine.process_request(request)
            
            self.assertEqual(response["requestId"], "test_req_7")
            self.assertIn("error", response)


class TestStatsAndUtilities(TestVectorEngine):
    """Test statistics and utility functions."""
    
    def setUp(self):
        super().setUp()
        self.engine = self.create_test_engine()
    
    def test_stats_empty_index(self):
        """Test stats on empty index."""
        stats = self.engine.get_stats()
        
        self.assertEqual(stats["total_vectors"], 0)
        self.assertEqual(stats["dimension"], 384)
        self.assertEqual(stats["metadata_count"], 0)
    
    def test_stats_with_data(self):
        """Test stats with data."""
        # Add some data
        texts = ["Doc 1", "Doc 2", "Doc 3"]
        metadata = [{"id": f"doc{i}"} for i in range(3)]
        self.engine.add_embeddings(texts, metadata)
        
        stats = self.engine.get_stats()
        
        self.assertEqual(stats["total_vectors"], 3)
        self.assertEqual(stats["dimension"], 384)
        self.assertEqual(stats["metadata_count"], 3)
    
    def test_stats_consistency(self):
        """Test that stats remain consistent after operations."""
        # Add data
        self.engine.add_embeddings(["Doc 1", "Doc 2"], [{"id": "1"}, {"id": "2"}])
        
        stats1 = self.engine.get_stats()
        
        # Remove one
        self.engine.remove_embeddings([0])
        
        stats2 = self.engine.get_stats()
        
        self.assertEqual(stats2["total_vectors"], stats1["total_vectors"] - 1)
        self.assertEqual(stats2["metadata_count"], stats1["metadata_count"] - 1)


class TestConcurrency(TestVectorEngine):
    """Test concurrent operations."""
    
    def setUp(self):
        super().setUp()
        self.engine = self.create_test_engine()
    
    def test_concurrent_additions(self):
        """Test concurrent embedding additions."""
        results = []
        errors = []
        
        def add_embeddings(thread_id):
            try:
                texts = [f"Document {thread_id}_{i}" for i in range(10)]
                metadata = [{"thread": thread_id, "doc": i} for i in range(10)]
                result = self.engine.add_embeddings(texts, metadata)
                results.append(result)
            except Exception as e:
                errors.append(e)
        
        threads = []
        for i in range(5):
            thread = threading.Thread(target=add_embeddings, args=(i,))
            threads.append(thread)
            thread.start()
        
        for thread in threads:
            thread.join()
        
        # Check that all operations completed
        self.assertEqual(len(errors), 0)
        self.assertEqual(len(results), 5)
        
        # Check final state
        stats = self.engine.get_stats()
        self.assertEqual(stats["total_vectors"], 50)  # 5 threads × 10 docs each
    
    def test_concurrent_search_and_add(self):
        """Test concurrent search and add operations."""
        # Add initial data
        initial_texts = [f"Initial doc {i}" for i in range(10)]
        initial_metadata = [{"type": "initial", "id": i} for i in range(10)]
        self.engine.add_embeddings(initial_texts, initial_metadata)
        
        search_results = []
        add_results = []
        errors = []
        
        def search_operation():
            try:
                for i in range(20):
                    results = self.engine.search(f"query {i}", k=5)
                    search_results.append(results)
                    time.sleep(0.001)  # Small delay
            except Exception as e:
                errors.append(e)
        
        def add_operation():
            try:
                for i in range(10):
                    texts = [f"New doc {i}"]
                    metadata = [{"type": "new", "id": i}]
                    result = self.engine.add_embeddings(texts, metadata)
                    add_results.append(result)
                    time.sleep(0.001)  # Small delay
            except Exception as e:
                errors.append(e)
        
        # Start threads
        search_thread = threading.Thread(target=search_operation)
        add_thread = threading.Thread(target=add_operation)
        
        search_thread.start()
        add_thread.start()
        
        search_thread.join()
        add_thread.join()
        
        # Check that operations completed without errors
        self.assertEqual(len(errors), 0)
        self.assertGreater(len(search_results), 0)
        self.assertGreater(len(add_results), 0)


class TestEdgeCases(TestVectorEngine):
    """Test edge cases and boundary conditions."""
    
    def setUp(self):
        super().setUp()
        self.engine = self.create_test_engine()
    
    def test_extremely_large_batch(self):
        """Test adding extremely large batch of embeddings."""
        # This might be memory-intensive, so use smaller batch in actual test
        large_batch_size = 1000
        texts = [f"Document number {i} with some content" for i in range(large_batch_size)]
        metadata = [{"id": i, "batch": "large"} for i in range(large_batch_size)]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), large_batch_size)
    
    def test_empty_string_documents(self):
        """Test adding empty string documents."""
        texts = ["", " ", "\n", "\t"]
        metadata = [{"type": f"empty_{i}"} for i in range(len(texts))]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), len(texts))
    
    def test_very_long_metadata(self):
        """Test with very long metadata."""
        texts = ["Test document"]
        large_metadata = {
            "id": "test",
            "very_long_field": "x" * 10000,
            "nested": {
                "deep": {
                    "structure": ["with", "many", "elements"] * 100
                }
            }
        }
        metadata = [large_metadata]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        self.assertEqual(len(result["vectorIds"]), 1)
    
    def test_unicode_and_special_chars_in_metadata(self):
        """Test unicode and special characters in metadata."""
        texts = ["Test document"]
        special_metadata = {
            "unicode": "测试数据 🎉",
            "symbols": "!@#$%^&*()",
            "quotes": 'single "double" `backtick`',
            "newlines": "line1\nline2\tline3"
        }
        metadata = [special_metadata]
        
        result = self.engine.add_embeddings(texts, metadata)
        
        self.assertIn("vectorIds", result)
        
        # Verify metadata is preserved
        vector_id = result["vectorIds"][0]
        self.assertEqual(self.engine.metadata[vector_id]["unicode"], "测试数据 🎉")
    
    def test_null_and_none_values(self):
        """Test handling of null and None values."""
        texts = ["Test document", None, "Another document"]
        metadata = [
            {"id": "valid"},
            None,
            {"id": "also_valid", "null_field": None}
        ]
        
        # This might cause an error, which should be handled gracefully
        result = self.engine.add_embeddings(texts, metadata)
        
        # Should either succeed partially or return an error
        self.assertIsInstance(result, dict)
    
    def test_mismatched_text_metadata_lengths(self):
        """Test mismatched lengths of texts and metadata."""
        texts = ["Doc 1", "Doc 2", "Doc 3"]
        metadata = [{"id": "1"}, {"id": "2"}]  # One less metadata
        
        # Should handle gracefully
        result = self.engine.add_embeddings(texts, metadata)
        
        # Might succeed with partial data or return error
        self.assertIsInstance(result, dict)
    
    def test_search_with_extreme_k_values(self):
        """Test search with extreme k values."""
        # Add some data
        self.engine.add_embeddings(["Test doc"], [{"id": "test"}])
        
        # Test extreme values
        extreme_k_values = [0, -1, 1000000, float('inf')]
        
        for k in extreme_k_values:
            try:
                results = self.engine.search("test", k=int(k) if k != float('inf') else 999999)
                self.assertIsInstance(results, list)
            except (ValueError, OverflowError):
                # These exceptions are acceptable for extreme values
                pass


class TestMainFunction(TestVectorEngine):
    """Test the main function and CLI interface."""
    
    @patch('sys.stdin')
    @patch('sys.stdout', new_callable=StringIO)
    def test_main_function_basic(self, mock_stdout, mock_stdin):
        """Test basic main function operation."""
        # Mock stdin to provide JSON requests
        mock_stdin.__iter__ = Mock(return_value=iter([
            '{"requestId": "1", "action": "stats"}\n'
        ]))
        
        # Import and run main (this would normally run forever)
        from vector_engine import main
        
        try:
            with patch('vector_engine.VectorEngine') as mock_engine_class:
                mock_engine = Mock()
                mock_engine.process_request.return_value = {"requestId": "1", "result": {"total_vectors": 0}}
                mock_engine_class.return_value = mock_engine
                
                # Run main with a timeout to avoid infinite loop
                import threading
                import time
                
                def run_main():
                    main()
                
                main_thread = threading.Thread(target=run_main)
                main_thread.daemon = True
                main_thread.start()
                
                time.sleep(0.1)  # Let it process
                
                # Check that engine was created and process_request was called
                mock_engine_class.assert_called_once()
                
        except SystemExit:
            # Expected when stdin closes
            pass
    
    @patch('sys.stdin')
    @patch('sys.stdout', new_callable=StringIO)
    def test_main_function_json_error(self, mock_stdout, mock_stdin):
        """Test main function with invalid JSON."""
        mock_stdin.__iter__ = Mock(return_value=iter([
            'invalid json\n',
            '{"requestId": "1", "action": "stats"}\n'
        ]))
        
        from vector_engine import main
        
        try:
            with patch('vector_engine.VectorEngine') as mock_engine_class:
                mock_engine = Mock()
                mock_engine.process_request.return_value = {"requestId": "1", "result": {}}
                mock_engine_class.return_value = mock_engine
                
                def run_main():
                    main()
                
                main_thread = threading.Thread(target=run_main)
                main_thread.daemon = True
                main_thread.start()
                
                time.sleep(0.1)
                
        except SystemExit:
            pass


if __name__ == '__main__':
    # Configure test runner
    unittest.main(verbosity=2, buffer=True)