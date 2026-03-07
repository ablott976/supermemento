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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test Case 1: Successful filtered vector search with container filter
  test('POST /api/search/vector - should perform filtered search successfully', async () => {
    const query = 'machine learning';
    const containerId = 'container-123';
    const mockResults = [
      {
        id: 'chunk-1',
        content: 'Machine learning is a subset of AI...',
        score: 0.95,
        metadata: { source: 'doc1.pdf' },
        containerId: 'container-123'
      },
      {
        id: 'chunk-2',
        content: 'Deep learning techniques...',
        score: 0.87,
        metadata: { source: 'doc2.pdf' },
        containerId: 'container-123'
      }
    ];

    filteredVectorSearch.mockResolvedValue({
      results: mockResults,
      total: 2,
      query: query
    });

    const response = await request(app)
      .post('/api/search/vector')
      .send({
        query,
        filters: { containerId },
        limit: 10
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.total).toBe(2);
    expect(filteredVectorSearch).toHaveBeenCalledWith({
      query,
      filters: { containerId },
      limit: 10,
      rewriteQuery: undefined
    });
  });

  // Test Case 2: Filtered search with query rewriting enabled
  test('POST /api/search/vector - should rewrite query when rewriteQuery is true', async () => {
    const query = 'ML';
    const rewrittenQuery = 'machine learning ML artificial intelligence AI';
    const mockResults = [
      {
        id: 'chunk-1',
        content: 'Machine learning algorithms...',
        score: 0.92,
        metadata: {},
        containerId: 'container-456'
      }
    ];

    filteredVectorSearch.mockResolvedValue({
      results: mockResults,
      total: 1,
      query: query,
      rewrittenQuery: rewrittenQuery
    });

    const response = await request(app)
      .post('/api/search/vector')
      .send({
        query,
        filters: { contentType: 'document' },
        rewriteQuery: true
      });

    expect(response.status).toBe(200);
    expect(response.body.rewrittenQuery).toBe(rewrittenQuery);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        rewriteQuery: true
      })
    );
  });

  // Test Case 3: Filtered search with date range filters
  test('POST /api/search/vector - should handle date range filters', async () => {
    const query = 'quarterly report';
    const dateFrom = '2024-01-01';
    const dateTo = '2024-12-31';

    filteredVectorSearch.mockResolvedValue({
      results: [],
      total: 0,
      query: query
    });

    const response = await request(app)
      .post('/api/search/vector')
      .send({
        query,
        filters: {
          dateRange: { start: dateFrom, end: dateTo }
        }
      });

    expect(response.status).toBe(200);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          dateRange: expect.objectContaining({
            start: expect.any(String),
            end: expect.any(String)
          })
        })
      })
    );
  });

  // Test Case 4: Bad request - missing query
  test('POST /api/search/vector - should return 400 if query is missing', async () => {
    const response = await request(app)
      .post('/api/search/vector')
      .send({
        filters: { containerId: 'container-123' }
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 5: Bad request - invalid query type
  test('POST /api/search/vector - should return 400 if query is not a string', async () => {
    const response = await request(app)
      .post('/api/search/vector')
      .send({
        query: 12345,
        filters: { containerId: 'container-123' }
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Query is required and must be a string.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 6: Bad request - invalid limit
  test('POST /api/search/vector - should return 400 if limit is invalid', async () => {
    const response = await request(app)
      .post('/api/search/vector')
      .send({
        query: 'test',
        limit: 'invalid'
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Limit must be a positive integer.' });
    expect(filteredVectorSearch).not.toHaveBeenCalled();
  });

  // Test Case 7: Error handling - filteredVectorSearch throws error
  test('POST /api/search/vector - should return 500 if search fails', async () => {
    const query = 'test query';
    const errorMessage = 'Vector search failed';

    filteredVectorSearch.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ 
      message: 'Failed to perform vector search.', 
      error: errorMessage 
    });
  });

  // Test Case 8: Successful search without filters (unfiltered)
  test('POST /api/search/vector - should work without filters', async () => {
    const query = 'general search';
    
    filteredVectorSearch.mockResolvedValue({
      results: [{ id: '1', content: 'result', score: 0.8, metadata: {} }],
      total: 1,
      query
    });

    const response = await request(app)
      .post('/api/search/vector')
      .send({ query });

    expect(response.status).toBe(200);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        filters: undefined
      })
    );
  });

  // Test Case 9: Search with metadata filters
  test('POST /api/search/vector - should handle metadata filters', async () => {
    const query = 'project alpha';
    const metadata = { department: 'engineering', status: 'active' };

    filteredVectorSearch.mockResolvedValue({
      results: [],
      total: 0,
      query
    });

    const response = await request(app)
      .post('/api/search/vector')
      .send({
        query,
        filters: { metadata }
      });

    expect(response.status).toBe(200);
    expect(filteredVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ metadata })
      })
    );
  });
});
