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
  });
});

describe('Filtered Vector Search API', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test Case 1: Successful filtered vector search with all parameters
  test('POST /api/search/vector - should perform filtered vector search successfully with query, filters, and topK', async () => {
    const query = 'machine learning';
    const filters = { containerId: 'container-123', tags: ['ai', 'ml'] };
    const topK = 5;
    const mockResults = [
      { id: 'doc-1', score: 0.95, content: 'Introduction to ML', metadata: { containerId: 'container-123' } },
      { id: 'doc-2', score: 0.87, content: 'Deep Learning Basics', metadata: { containerId: 'container-123' } }
    ];

    filteredVectorSearch.mockResolvedValue(mockResults);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, filters, topK });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: mockResults });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(query, filters, topK);
  });

  // Test Case 2: Successful search with only query (no filters)
  test('POST /api/search/vector - should perform search with query only', async () => {
    const query = 'neural networks';
    const mockResults = [
      { id: 'doc-3', score: 0.92, content: 'Neural Networks 101', metadata: {} }
    ];

    filteredVectorSearch.mockResolvedValue(mockResults);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: mockResults });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(query, undefined, undefined);
  });

  // Test Case 3: Successful search with query and filters but no topK
  test('POST /api/search/vector - should perform search with query and filters using default topK', async () => {
    const query = 'data science';
    const filters = { containerId: 'container-456' };
    const mockResults = [
      { id: 'doc-4', score: 0.88, content: 'Data Science Overview', metadata: { containerId: 'container-456' } }
    ];

    filteredVectorSearch.mockResolvedValue(mockResults);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, filters });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: mockResults });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
    expect(filteredVectorSearch).toHaveBeenCalledWith(query, filters, undefined);
  });

  // Test Case 4: Bad request - missing query
  test('POST /api/search/vector - should return 400 if query is missing', async () => {
    const filters = { containerId: 'container-123' };

    const response = await request(app)
      .post('/api/search/vector')
      .send({ filters });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 5: Bad request - invalid query type
  test('POST /api/search/vector - should return 400 if query is not a string', async () => {
    const query = 12345; // Invalid type

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 6: Bad request - invalid filters type
  test('POST /api/search/vector - should return 400 if filters is not an object', async () => {
    const query = 'test query';
    const filters = 'invalid-filters'; // Should be object

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, filters });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Filters must be an object if provided.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 7: Bad request - invalid topK type
  test('POST /api/search/vector - should return 400 if topK is not a number', async () => {
    const query = 'test query';
    const topK = 'ten'; // Invalid type

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, topK });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'topK must be a positive integer if provided.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 8: Bad request - negative topK
  test('POST /api/search/vector - should return 400 if topK is negative', async () => {
    const query = 'test query';
    const topK = -5;

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query, topK });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'topK must be a positive integer if provided.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 9: Error handling - filteredVectorSearch throws an error
  test('POST /api/search/vector - should return 500 if vector search fails', async () => {
    const query = 'test query';
    const errorMessage = 'Vector database connection failed';
    
    filteredVectorSearch.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to perform vector search.', error: errorMessage });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
  });

  // Test Case 10: Error handling - filteredVectorSearch returns null/empty results
  test('POST /api/search/vector - should return empty results when no matches found', async () => {
    const query = 'nonexistent content';
    
    filteredVectorSearch.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [] });
    expect(filteredVectorSearch).toHaveBeenCalledTimes(1);
  });
});
