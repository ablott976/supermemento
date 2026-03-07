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

    it('should handle empty results efficiently', async () => {
      mockResult.records = [];
      
      const memories = await client.listMemories();
      expect(memories).toEqual([]);
      expect(memories).toHaveLength(0);
      
      const documents = await client.listDocuments();
      expect(documents).toEqual([]);
      expect(documents).toHaveLength(0);
    });

    it('should handle large result sets without embedding/rawContent payload overhead', async () => {
      // Simulate many records with large data that would be excluded
      mockResult.records = Array.from({ length: 50 }, (_, i) => ({
        get: jest.fn().mockReturnValue({
          id: `mem-${i}`,
          content: `Content ${i}`,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as unknown as Neo4jRecord));

      const memories = await client.listMemories();
      expect(memories).toHaveLength(50);
      // Verify no memory has embedding field
      memories.forEach(memory => {
        expect(memory).not.toHaveProperty('embedding');
      });
    });
  });
});
