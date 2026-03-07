// src/tests/ingestion.test.ts
import request from 'supertest';
// Assuming the express app is exported from src/server.ts
// If it's exported differently, this import will need adjustment.
// For now, I'll assume a default export or a named export like 'app'.
// Let's try to import the app. If this fails, I will need to investigate src/server.ts
import app from '../src/server'; // This might need adjustment.

// Mock the neo4j-client module
jest.mock('../src/db/neo4j-client', () => ({
  set_container_config: jest.fn(),
  getContainerFilterPrompt: jest.fn(), // Mocking this too, as required for GET tests
  filteredVectorSearch: jest.fn(), // Mock for filtered vector search
}));

// Get the mocked functions
const { set_container_config, getContainerFilterPrompt, filteredVectorSearch } = require('../src/db/neo4j-client');

describe('Ingestion API - Container Config', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- POST /api/ingestion/container-config tests ---
  // Test Case 1: Successful configuration with filter prompt
  test('POST /api/ingestion/container-config - should set container configuration successfully with a filter prompt', async () => {
    const containerId = 'test-container-123';
    const filterPrompt = 'Summarize the content.';
    
    set_container_config.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/api/ingestion/container-config')
      .send({ containerId, filterPrompt });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Container configuration set successfully.' });
    expect(set_container_config).toHaveBeenCalledTimes(1);
    expect(set_container_config).toHaveBeenCalledWith(containerId, filterPrompt);
  });

  // Test Case 2: Successful configuration without filter prompt
  test('POST /api/ingestion/container-config - should set container configuration successfully without a filter prompt', async () => {
    const containerId = 'test-container-456';
    
    set_container_config.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/api/ingestion/container-config')
      .send({ containerId }); // filterPrompt is omitted

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Container configuration set successfully.' });
    expect(set_container_config).toHaveBeenCalledTimes(1);
    expect(set_container_config).toHaveBeenCalledWith(containerId, undefined);
  });

  // Test Case 3: Bad request - missing containerId
  test('POST /api/ingestion/container-config - should return 400 if containerId is missing', async () => {
    const filterPrompt = 'Summarize the content.';
    
    const response = await request(app)
      .post('/api/ingestion/container-config')
      .send({ filterPrompt }); // containerId is missing

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'containerId is required and must be a string.' });
    expect(set_container_config).not.toHaveBeenCalled();
  });

  // Test Case 4: Bad request - invalid containerId type
  test('POST /api/ingestion/container-config - should return 400 if containerId is not a string', async () => {
    const containerId = 12345; // Invalid type
    const filterPrompt = 'Summarize the content.';
    
    const response = await request(app)
      .post('/api/ingestion/container-config')
      .send({ containerId, filterPrompt });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'containerId is required and must be a string.' });
    expect(set_container_config).not.toHaveBeenCalled();
  });

  // Test Case 5: Bad request - invalid filterPrompt type
  test('POST /api/ingestion/container-config - should return 400 if filterPrompt is provided but not a string', async () => {
    const containerId = 'test-container-789';
    const filterPrompt = 12345; // Invalid type
    
    const response = await request(app)
      .post('/api/ingestion/container-config')
      .send({ containerId, filterPrompt });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'filterPrompt must be a string if provided.' });
    expect(set_container_config).not.toHaveBeenCalled();
  });

  // Test Case 6: Error handling - set_container_config throws an error
  test('POST /api/ingestion/container-config - should return 500 if setting container config fails', async () => {
    const containerId = 'test-container-error';
    const filterPrompt = 'This will fail.';
    const errorMessage = 'Database connection error';
    
    set_container_config.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .post('/api/ingestion/container-config')
      .send({ containerId, filterPrompt });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to set container configuration.', error: errorMessage });
    expect(set_container_config).toHaveBeenCalledTimes(1);
    expect(set_container_config).toHaveBeenCalledWith(containerId, filterPrompt);
  });
});

describe('Filtered Vector Search API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockSearchResults = [
    {
      id: 'mem-1',
      type: 'memory',
      score: 0.95,
      content: 'Test memory content',
      containerTag: 'container-a',
      sourceDocId: 'doc-1',
      memoryType: 'episodic'
    },
    {
      id: 'chunk-1',
      type: 'chunk',
      score: 0.87,
      content: 'Test chunk content',
      containerTag: 'container-a',
      sourceDocId: 'doc-1',
      chunkIndex: 0
    }
  ];

  // Test Case 1: Successful filtered vector search with container tag
  test('POST /api/search/vector - should perform filtered search with container tag', async () => {
    const query = 'test query';
    const containerTag = 'container-a';
    
    filteredVectorSearch.mockResolvedValue(mockSearchResults);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, containerTag });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        filters: expect.objectContaining({ containerTag })
      })
    );
  });

  // Test Case 2: Filtered search with memory types
  test('POST /api/search/vector - should filter by memory types', async () => {
    const query = 'test query';
    const memoryTypes = ['episodic', 'semantic'];
    
    filteredVectorSearch.mockResolvedValue([mockSearchResults[0]]);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, memoryTypes });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        filters: expect.objectContaining({ memoryTypes })
      })
    );
  });

  // Test Case 3: Filtered search with minimum similarity threshold
  test('POST /api/search/vector - should apply minimum similarity filter', async () => {
    const query = 'test query';
    const minSimilarity = 0.9;
    
    filteredVectorSearch.mockResolvedValue([mockSearchResults[0]]); // Only the 0.95 score item

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, minSimilarity });

    expect(response.status).toBe(200);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        filters: expect.objectContaining({ minSimilarity })
      })
    );
  });

  // Test Case 4: Filtered search with multiple filters
  test('POST /api/search/vector - should apply multiple filters simultaneously', async () => {
    const query = 'test query';
    const filters = {
      containerTag: 'container-a',
      memoryTypes: ['episodic'],
      minSimilarity: 0.9,
      metadata: { key: 'value' }
    };
    
    filteredVectorSearch.mockResolvedValue([mockSearchResults[0]]);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, ...filters });

    expect(response.status).toBe(200);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        filters: expect.objectContaining(filters)
      })
    );
  });

  // Test Case 5: Bad request - missing query
  test('POST /api/search/vector - should return 400 if query is missing', async () => {
    const response = await request(app)
      .post('/api/search/vector')
      .send({ containerTag: 'container-a' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 6: Bad request - invalid filter types
  test('POST /api/search/vector - should return 400 if filters have invalid types', async () => {
    const response = await request(app)
      .post('/api/search/vector')
      .send({ 
        query: 'test', 
        minSimilarity: 'not-a-number' 
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'minSimilarity must be a number between 0 and 1.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 7: Error handling - search service failure
  test('POST /api/search/vector - should return 500 if search fails', async () => {
    const query = 'test query';
    const errorMessage = 'Vector search service unavailable';
    
    filteredVectorSearch.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ 
      message: 'Failed to perform filtered vector search.', 
      error: errorMessage 
    });
  });

  // Test Case 8: Empty results handling
  test('POST /api/search/vector - should return empty array when no matches found', async () => {
    const query = 'nonexistent query';
    
    filteredVectorSearch.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
    expect(response.body.total).toBe(0);
  });
});
