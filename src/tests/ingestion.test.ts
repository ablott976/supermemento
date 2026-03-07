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
}));

// Get the mocked functions
const { set_container_config, getContainerFilterPrompt } = require('../src/db/neo4j-client');

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

    // Test Case 7: Conflict - trying to set config for an existing container with conflicting data
    test('POST /api/ingestion/container-config - should return 409 if configuration conflicts', async () => {
        const containerId = 'test-container-conflict';
        const filterPrompt = 'This prompt causes a conflict.';
        
        // Mock set_container_config to simulate a conflict scenario.
        // This assumes the route handler in ingestion.ts is set up to catch such errors
        // and return a 409 status code.
        const conflictError = {
            status: 409,
            message: 'Container configuration conflict detected.',
        };
        set_container_config.mockRejectedValue(conflictError);

        const response = await request(app)
            .post('/api/ingestion/container-config')
            .send({ containerId, filterPrompt });

        expect(response.status).toBe(409);
        // Assuming the route handler returns the error message from the rejected value
        expect(response.body).toEqual({ message: conflictError.message });
        expect(set_container_config).toHaveBeenCalledTimes(1);
        expect(set_container_config).toHaveBeenCalledWith(containerId, filterPrompt);
    });


    // --- GET /api/ingestion/container-config tests ---

    // Test Case 8: Successfully retrieve container configuration
    test('GET /api/ingestion/container-config - should return container configuration successfully', async () => {
        const containerId = 'test-container-retrieval';
        const filterPrompt = 'Analyze user sentiment.';

        getContainerFilterPrompt.mockResolvedValue(filterPrompt);

        const response = await request(app)
            .get('/api/ingestion/container-config')
            .query({ containerId });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ containerId, filterPrompt });
        expect(getContainerFilterPrompt).toHaveBeenCalledTimes(1);
        expect(getContainerFilterPrompt).toHaveBeenCalledWith(containerId);
    });

    // Test Case 9: Container configuration not found
    test('GET /api/ingestion/container-config - should return 404 if container configuration is not found', async () => {
        const containerId = 'non-existent-container';

        getContainerFilterPrompt.mockResolvedValue(null); // Simulate not found

        const response = await request(app)
            .get('/api/ingestion/container-config')
            .query({ containerId });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Container configuration not found.' });
        expect(getContainerFilterPrompt).toHaveBeenCalledTimes(1);
        expect(getContainerFilterPrompt).toHaveBeenCalledWith(containerId);
    });

    // Test Case 10: Bad request - missing containerId for GET
    test('GET /api/ingestion/container-config - should return 400 if containerId is missing', async () => {
        const response = await request(app)
            .get('/api/ingestion/container-config'); // containerId is missing

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: 'containerId is required and must be a string.' });
        expect(getContainerFilterPrompt).not.toHaveBeenCalled();
    });

    // Test Case 11: Bad request - invalid containerId type for GET
    test('GET /api/ingestion/container-config - should return 400 if containerId is not a string', async () => {
        const containerId = 12345; // Invalid type

        const response = await request(app)
            .get('/api/ingestion/container-config')
            .query({ containerId });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: 'containerId is required and must be a string.' });
        expect(getContainerFilterPrompt).not.toHaveBeenCalled();
    });

    // Test Case 12: Error handling - getContainerFilterPrompt throws an error
    test('GET /api/ingestion/container-config - should return 500 if getting container config fails', async () => {
        const containerId = 'container-error';
        const errorMessage = 'Database query error';

        getContainerFilterPrompt.mockRejectedValue(new Error(errorMessage));

        const response = await request(app)
            .get('/api/ingestion/container-config')
            .query({ containerId });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Failed to get container configuration.', error: errorMessage });
        expect(getContainerFilterPrompt).toHaveBeenCalledTimes(1);
        expect(getContainerFilterPrompt).toHaveBeenCalledWith(containerId);
    });
});
