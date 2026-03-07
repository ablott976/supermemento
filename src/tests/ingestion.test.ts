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
  getContainerFilterPrompt: jest.fn(),
  listMemories: jest.fn(), // Added for listMemories tests
}));

// Get the mocked functions
const { set_container_config, getContainerFilterPrompt, listMemories } = require('../src/db/neo4j-client');

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
  });
});

describe('Ingestion API - List Memories', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test Case 1: Successful retrieval of memories with containerId
  test('GET /api/ingestion/memories - should return list of memories successfully', async () => {
    const containerId = 'test-container-memories';
    const mockMemories = [
      { 
        id: 'mem-1', 
        content: 'Memory content 1', 
        createdAt: '2024-01-15T10:00:00Z',
        metadata: { source: 'test', confidence: 0.95 }
      },
      { 
        id: 'mem-2', 
        content: 'Memory content 2', 
        createdAt: '2024-01-16T11:00:00Z',
        metadata: { source: 'test', confidence: 0.87 }
      }
    ];
    
    listMemories.mockResolvedValue(mockMemories);

    const response = await request(app)
      .get('/api/ingestion/memories')
      .query({ containerId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockMemories);
    expect(listMemories).toHaveBeenCalledTimes(1);
    expect(listMemories).toHaveBeenCalledWith(containerId);
  });

  // Test Case 2: Successful retrieval with empty list
  test('GET /api/ingestion/memories - should return empty array when no memories exist', async () => {
    const containerId = 'empty-container';
    
    listMemories.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/ingestion/memories')
      .query({ containerId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(listMemories).toHaveBeenCalledWith(containerId);
  });

  // Test Case 3: Bad request - missing containerId
  test('GET /api/ingestion/memories - should return 400 if containerId is missing', async () => {
    const response = await request(app)
      .get('/api/ingestion/memories');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'containerId query parameter is required.' });
    expect(listMemories).not.toHaveBeenCalled();
  });

  // Test Case 4: Error handling - listMemories throws an error
  test('GET /api/ingestion/memories - should return 500 if database query fails', async () => {
    const containerId = 'test-container-error';
    const errorMessage = 'Database query failed';
    
    listMemories.mockRejectedValue(new Error(errorMessage));

    const response = await request(app)
      .get('/api/ingestion/memories')
      .query({ containerId });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ 
      message: 'Failed to retrieve memories.', 
      error: errorMessage 
    });
  });

  // Test Case 5: Response structure validation
  test('GET /api/ingestion/memories - should return memories with correct structure', async () => {
    const containerId = 'test-container-structure';
    const mockMemories = [
      { 
        id: 'mem-uuid-123', 
        content: 'Test memory content', 
        createdAt: '2024-01-20T12:00:00Z',
        updatedAt: '2024-01-20T12:00:00Z',
        containerId: containerId,
        metadata: { 
          source: 'ingestion-api',
          processingStage: 'completed',
          confidenceScore: 0.92,
          tags: ['test', 'example']
        }
      }
    ];
    
    listMemories.mockResolvedValue(mockMemories);

    const response = await request(app)
      .get('/api/ingestion/memories')
      .query({ containerId });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(1);
    expect(response.body[0]).toHaveProperty('id');
    expect(response.body[0]).toHaveProperty('content');
    expect(response.body[0]).toHaveProperty('createdAt');
    expect(response.body[0]).toHaveProperty('metadata');
    expect(typeof response.body[0].metadata).toBe('object');
  });
});
