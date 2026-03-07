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

describe('Ingestion API - Filtered Vector Search', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test Case 1: Successful filtered vector search with all parameters
  test('POST /api/ingestion/filtered-vector-search - should perform search successfully with filters', async () => {
    const mockResults = [
      { id: 'doc-1', score: 0.95, content: 'Test content 1', metadata: { status: 'active' } },
      { id: 'doc-2', score: 0.85, content: 'Test content 2', metadata: { status: 'active' } },
    ];
    
    filteredVectorSearch.mockResolvedValue(mockResults);

    const searchPayload = {
      query: 'test query',
      containerId: 'container-123',
      filters: { status: 'active', type: 'document' },
      limit: 10,
    };

    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send(searchPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: mockResults });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      searchPayload.query,
      searchPayload.containerId,
      searchPayload.filters,
      searchPayload.limit
    );
  });

  // Test Case 2: Successful search without optional filters
  test('POST /api/ingestion/filtered-vector-search - should perform search without optional filters', async () => {
    const mockResults = [
      { id: 'doc-1', score: 0.95, content: 'Test content 1' },
    ];
    
    filteredVectorSearch.mockResolvedValue(mockResults);

    const searchPayload = {
      query: 'another query',
      containerId: 'container-456',
    };

    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send(searchPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: mockResults });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      searchPayload.query,
      searchPayload.containerId,
      undefined,
      undefined
    );
  });

  // Test Case 3: Bad request - missing query
  test('POST /api/ingestion/filtered-vector-search - should return 400 if query is missing', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ containerId: 'container-123', filters: {} });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 4: Bad request - invalid query type
  test('POST /api/ingestion/filtered-vector-search - should return 400 if query is not a string', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 12345, containerId: 'container-123' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 5: Bad request - missing containerId
  test('POST /api/ingestion/filtered-vector-search - should return 400 if containerId is missing', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'test query', filters: {} });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'containerId is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 6: Bad request - invalid containerId type
  test('POST /api/ingestion/filtered-vector-search - should return 400 if containerId is not a string', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'test query', containerId: 12345 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'containerId is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 7: Bad request - invalid filters type
  test('POST /api/ingestion/filtered-vector-search - should return 400 if filters is not an object', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'test query', containerId: 'container-123', filters: 'invalid' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'filters must be an object if provided.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 8: Bad request - invalid limit type
  test('POST /api/ingestion/filtered-vector-search - should return 400 if limit is not a number', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'test query', containerId: 'container-123', limit: 'ten' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'limit must be a positive integer if provided.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 9: Bad request - negative limit
  test('POST /api/ingestion/filtered-vector-search - should return 400 if limit is negative', async () => {
    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'test query', containerId: 'container-123', limit: -5 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'limit must be a positive integer if provided.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 10: Error handling - filteredVectorSearch throws an error
  test('POST /api/ingestion/filtered-vector-search - should return 500 if search fails', async () => {
    const errorMessage = 'Vector search failed';
    filteredVectorSearch.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'test query', containerId: 'container-123' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to perform filtered vector search.', error: errorMessage });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
  });

  // Test Case 11: Empty results
  test('POST /api/ingestion/filtered-vector-search - should return empty array when no results found', async () => {
    filteredVectorSearch.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/ingestion/filtered-vector-search')
      .send({ query: 'nonexistent query', containerId: 'container-123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [] });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
  });
});
