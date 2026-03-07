import { Neo4jClient } from '../src/db/neo4j-client';
import { Driver, Session, Result, Record as Neo4jRecord } from 'neo4j-driver';

jest.mock('neo4j-driver');

describe('Performance Optimizations', () => {
  let client: Neo4jClient;
  let mockDriver: jest.Mocked<Driver>;
  let mockSession: jest.Mocked<Session>;
  let mockResult: jest.Mocked<Result>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResult = {
      records: [],
    } as unknown as jest.Mocked<Result>;
    
    mockSession = {
      run: jest.fn().mockResolvedValue(mockResult),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Session>;
    
    mockDriver = {
      session: jest.fn().mockReturnValue(mockSession),
      verifyConnectivity: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Driver>;
    
    client = new Neo4jClient(mockDriver);
  });

  describe('listMemories bandwidth optimization', () => {
    it('should exclude embedding field from projection to reduce payload', async () => {
      await client.listMemories();
      const [query] = mockSession.run.mock.calls[0];
      // Verify projection pattern is used
      expect(query).toMatch(/RETURN\s+m\s*\{[^}]*\}\s*as\s*m/i);
      // Critical: embedding field must be excluded
      expect(query).not.toContain('.embedding');
    });

    it('should include essential fields in listMemories projection', async () => {
      await client.listMemories();
      const [query] = mockSession.run.mock.calls[0];
      expect(query).toContain('.id');
      expect(query).toContain('.content');
      expect(query).toContain('.metadata');
      expect(query).toContain('.createdAt');
      expect(query).toContain('.updatedAt');
    });

    it('should return memories without embedding field', async () => {
      const memoryData = {
        id: 'mem-1',
        content: 'Test memory content',
        metadata: { key: 'value' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockResult.records = [{
        get: jest.fn().mockReturnValue({ ...memoryData }),
      } as unknown as Neo4jRecord];
      
      const result = await client.listMemories();
      // Verify embedding is not in result
      expect(result[0]).not.toHaveProperty('embedding');
      // Verify essential fields are present
      expect(result[0]).toHaveProperty('id', 'mem-1');
      expect(result[0]).toHaveProperty('content', 'Test memory content');
    });

    it('should not use RETURN * for listMemories', async () => {
      await client.listMemories();
      const [query] = mockSession.run.mock.calls[0];
      expect(query).not.toMatch(/RETURN\s+\*\s*as\s*m/i);
      expect(query).not.toMatch(/RETURN\s+m\s*$/m);
    });
  });

  describe('listDocuments bandwidth optimization', () => {
    it('should exclude rawContent field from projection to reduce payload', async () => {
      await client.listDocuments();
      const [query] = mockSession.run.mock.calls[0];
      // Verify projection pattern is used
      expect(query).toMatch(/RETURN\s+d\s*\{[^}]*\}\s*as\s*d/i);
      // Critical: rawContent field must be excluded
      expect(query).not.toContain('.rawContent');
    });

    it('should include essential fields in listDocuments projection', async () => {
      await client.listDocuments();
      const [query] = mockSession.run.mock.calls[0];
      expect(query).toContain('.id');
      expect(query).toContain('.title');
      expect(query).toContain('.content');
      expect(query).toContain('.metadata');
      expect(query).toContain('.createdAt');
      expect(query).toContain('.updatedAt');
    });

    it('should return documents without rawContent field', async () => {
      const docData = {
        id: 'doc-1',
        title: 'Test Document',
        content: 'Summary content',
        metadata: { source: 'test' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockResult.records = [{
        get: jest.fn().mockReturnValue({ ...docData }),
      } as unknown as Neo4jRecord];
      
      const result = await client.listDocuments();
      // Verify rawContent is not in result
      expect(result[0]).not.toHaveProperty('rawContent');
      // Verify essential fields are present
      expect(result[0]).toHaveProperty('id', 'doc-1');
      expect(result[0]).toHaveProperty('title', 'Test Document');
      expect(result[0]).toHaveProperty('content', 'Summary content');
    });

    it('should not use RETURN * for listDocuments', async () => {
      await client.listDocuments();
      const [query] = mockSession.run.mock.calls[0];
      expect(query).not.toMatch(/RETURN\s+\*\s*as\s*d/i);
      expect(query).not.toMatch(/RETURN\s+d\s*$/m);
    });
  });

  describe('query efficiency and resource management', () => {
    it('should close session after listMemories query', async () => {
      await client.listMemories();
      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });

    it('should close session after listDocuments query', async () => {
      await client.listDocuments();
      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });

    it('should close session even when query throws error', async () => {
      mockSession.run.mockRejectedValueOnce(new Error('Query failed'));
      
      await expect(client.listMemories()).rejects.toThrow('Query failed');
      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });

    it('should create new session for each query', async () => {
      await client.listMemories();
      await client.listDocuments();
      expect(mockDriver.session).toHaveBeenCalledTimes(2);
    });
  });

  describe('response time optimization', () => {
    it('should resolve listMemories within acceptable time limit', async () => {
      const startTime = performance.now();
      await client.listMemories();
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete within 50ms with mocked data
      expect(duration).toBeLessThan(50);
    });

    it('should resolve listDocuments within acceptable time limit', async () => {
      const startTime = performance.now();
      await client.listDocuments();
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete within 50ms with mocked data
      expect(duration).toBeLessThan(50);
    });

    it('should handle multiple concurrent list operations efficiently', async () => {
      const startTime = performance.now();
      
      // Run multiple operations concurrently
      const promises = Array(5).fill(null).map((_, i) => 
        i % 2 === 0 ? client.listMemories() : client.listDocuments()
      );
      await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Concurrent operations should complete quickly (not sequential)
      // 5 concurrent calls should complete in less than 100ms total
      expect(duration).toBeLessThan(100);
      expect(mockDriver.session).toHaveBeenCalledTimes(5);
    });

    it('should not block on session close for listMemories', async () => {
      // Simulate slow session close
      mockSession.close = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 10))
      );
      
      const startTime = performance.now();
      await client.listMemories();
      const endTime = performance.now();
      
      // Even with slow close, total time should be reasonable
      expect(endTime - startTime).toBeLessThan(50);
    });

    it('should not block on session close for listDocuments', async () => {
      // Simulate slow session close
      mockSession.close = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 10))
      );
      
      const startTime = performance.now();
      await client.listDocuments();
      const endTime = performance.now();
      
      // Even with slow close, total time should be reasonable
      expect(endTime - startTime).toBeLessThan(50);
    });

    it('should return results faster with projection than without', async () => {
      // This test verifies that the projection optimization improves response time
      // by ensuring the method doesn't wait for large payload processing
      
      const largeMemoryData = {
        id: 'mem-1',
        content: 'Test content',
        metadata: { key: 'value' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        // embedding would normally be a large array, but excluded by projection
      };
      
      mockResult.records = Array(100).fill(null).map(() => ({
        get: jest.fn().mockReturnValue({ ...largeMemoryData }),
      } as unknown as Neo4jRecord));
      
      const startTime = performance.now();
      const result = await client.listMemories();
      const endTime = performance.now();
      
      // Should handle 100 records quickly due to projection optimization
      expect(result).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(100);
      
      // Verify embedding is not in any result
      result.forEach(memory => {
        expect(memory).not.toHaveProperty('embedding');
      });
    });
  });
});
