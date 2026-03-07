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

  // --- GET /api/ingestion/container-config tests ---

  // Test Case 7: Successful retrieval of container config
  test('GET /api/ingestion/container-config/:containerId - should retrieve container configuration successfully', async () => {
    const containerId = 'test-container-get-123';
    const mockFilterPrompt = 'Filter prompt for retrieval.';

    getContainerFilterPrompt.mockResolvedValue(mockFilterPrompt);

    const response = await request(app)
      .get(`/api/ingestion/container-config/${containerId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ containerId, filterPrompt: mockFilterPrompt });
    expect(getContainerFilterPrompt).toHaveBeenCalledTimes(1);
    expect(getContainerFilterPrompt).toHaveBeenCalledWith(containerId);
  });

  // Test Case 8: Retrieval for non-existent container
  test('GET /api/ingestion/container-config/:containerId - should return 404 if container not found', async () => {
    const containerId = 'non-existent-container';

    getContainerFilterPrompt.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/ingestion/container-config/${containerId}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Container configuration not found.' });
  });

  // Test Case 9: Error handling - getContainerFilterPrompt throws an error
  test('GET /api/ingestion/container-config/:containerId - should return 500 if retrieval fails', async () => {
    const containerId = 'test-container-get-error';
    const errorMessage = 'Database query failed';

    getContainerFilterPrompt.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .get(`/api/ingestion/container-config/${containerId}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to retrieve container configuration.', error: errorMessage });
  });
});

describe('Ingestion API - Filtered Vector Search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test Case 1: Successful vector search with query and filters
  test('POST /api/ingestion/search - should perform filtered vector search successfully', async () => {
    const mockResults = [
      {
        id: 'memory-1',
        content: 'Test memory content',
        score: 0.95,
        metadata: { container_id: 'container-123', timestamp: '2024-01-01' }
      },
      {
        id: 'memory-2',
        content: 'Another test memory',
        score: 0.87,
        metadata: { container_id: 'container-123', timestamp: '2024-01-02' }
      }
    ];

    filteredVectorSearch.mockResolvedValue(mockResults);

    const response = await request(app)
      .post('/api/ingestion/search')
      .send({
        query: 'test query',
        filters: { container_id: 'container-123' },
        limit: 10
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: mockResults });
    expect(filter
