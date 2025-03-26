const { MCPServer, StdioTransport } = require('@anthropic-ai/mcp-core');

// Initialize in-memory data store for our knowledge graph
const knowledgeGraph = {
  entities: {},
  relations: []
};

// Create a new MCP server
const server = new MCPServer({
  name: 'memory-server',
  version: '1.0.0',
  transport: new StdioTransport(),
  tools: [
    {
      name: 'create_entities',
      description: 'Create multiple new entities in the knowledge graph',
      handler: async ({ entities }) => {
        for (const entity of entities) {
          knowledgeGraph.entities[entity.name] = {
            name: entity.name,
            entityType: entity.entityType,
            observations: entity.observations || []
          };
        }
        return { success: true, entitiesCreated: entities.length };
      },
      inputSchema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'The name of the entity' },
                entityType: { type: 'string', description: 'The type of the entity' },
                observations: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'An array of observation contents associated with the entity'
                }
              },
              required: ['name', 'entityType', 'observations']
            }
          }
        },
        required: ['entities']
      }
    },
    {
      name: 'create_relations',
      description: 'Create multiple new relations between entities in the knowledge graph. Relations should be in active voice',
      handler: async ({ relations }) => {
        for (const relation of relations) {
          // Ensure both entities exist
          if (!knowledgeGraph.entities[relation.from]) {
            throw new Error(`Entity ${relation.from} does not exist`);
          }
          if (!knowledgeGraph.entities[relation.to]) {
            throw new Error(`Entity ${relation.to} does not exist`);
          }
          
          knowledgeGraph.relations.push({
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType
          });
        }
        return { success: true, relationsCreated: relations.length };
      },
      inputSchema: {
        type: 'object',
        properties: {
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'The name of the entity where the relation starts' },
                to: { type: 'string', description: 'The name of the entity where the relation ends' },
                relationType: { type: 'string', description: 'The type of the relation' }
              },
              required: ['from', 'to', 'relationType']
            }
          }
        },
        required: ['relations']
      }
    },
    {
      name: 'add_observations',
      description: 'Add new observations to existing entities in the knowledge graph',
      handler: async ({ observations }) => {
        for (const observation of observations) {
          if (!knowledgeGraph.entities[observation.entityName]) {
            throw new Error(`Entity ${observation.entityName} does not exist`);
          }
          
          knowledgeGraph.entities[observation.entityName].observations.push(...observation.contents);
        }
        return { success: true };
      },
      inputSchema: {
        type: 'object',
        properties: {
          observations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entityName: { type: 'string', description: 'The name of the entity to add the observations to' },
                contents: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'An array of observation contents to add'
                }
              },
              required: ['entityName', 'contents']
            }
          }
        },
        required: ['observations']
      }
    },
    {
      name: 'delete_entities',
      description: 'Delete multiple entities and their associated relations from the knowledge graph',
      handler: async ({ entityNames }) => {
        for (const entityName of entityNames) {
          delete knowledgeGraph.entities[entityName];
          
          // Also delete any relations involving this entity
          knowledgeGraph.relations = knowledgeGraph.relations.filter(
            relation => relation.from !== entityName && relation.to !== entityName
          );
        }
        return { success: true };
      },
      inputSchema: {
        type: 'object',
        properties: {
          entityNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'An array of entity names to delete'
          }
        },
        required: ['entityNames']
      }
    },
    {
      name: 'delete_observations',
      description: 'Delete specific observations from entities in the knowledge graph',
      handler: async ({ deletions }) => {
        for (const deletion of deletions) {
          if (!knowledgeGraph.entities[deletion.entityName]) {
            throw new Error(`Entity ${deletion.entityName} does not exist`);
          }
          
          const entity = knowledgeGraph.entities[deletion.entityName];
          entity.observations = entity.observations.filter(
            obs => !deletion.observations.includes(obs)
          );
        }
        return { success: true };
      },
      inputSchema: {
        type: 'object',
        properties: {
          deletions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entityName: { type: 'string', description: 'The name of the entity containing the observations' },
                observations: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'An array of observations to delete'
                }
              },
              required: ['entityName', 'observations']
            }
          }
        },
        required: ['deletions']
      }
    },
    {
      name: 'delete_relations',
      description: 'Delete multiple relations from the knowledge graph',
      handler: async ({ relations }) => {
        for (const relation of relations) {
          knowledgeGraph.relations = knowledgeGraph.relations.filter(
            r => !(r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType)
          );
        }
        return { success: true };
      },
      inputSchema: {
        type: 'object',
        properties: {
          relations: {
            type: 'array',
            description: 'An array of relations to delete',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'The name of the entity where the relation starts' },
                to: { type: 'string', description: 'The name of the entity where the relation ends' },
                relationType: { type: 'string', description: 'The type of the relation' }
              },
              required: ['from', 'to', 'relationType']
            }
          }
        },
        required: ['relations']
      }
    },
    {
      name: 'read_graph',
      description: 'Read the entire knowledge graph',
      handler: async () => {
        return {
          entities: knowledgeGraph.entities,
          relations: knowledgeGraph.relations
        };
      },
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'search_nodes',
      description: 'Search for nodes in the knowledge graph based on a query',
      handler: async ({ query }) => {
        const queryLower = query.toLowerCase();
        const matchingEntities = {};
        
        for (const [name, entity] of Object.entries(knowledgeGraph.entities)) {
          // Check if the entity name or type matches the query
          if (name.toLowerCase().includes(queryLower) || 
              entity.entityType.toLowerCase().includes(queryLower)) {
            matchingEntities[name] = entity;
            continue;
          }
          
          // Check if any observations match the query
          const hasMatchingObservation = entity.observations.some(
            obs => obs.toLowerCase().includes(queryLower)
          );
          
          if (hasMatchingObservation) {
            matchingEntities[name] = entity;
          }
        }
        
        // Get relations where both entities are in the matching set
        const matchingRelations = knowledgeGraph.relations.filter(
          relation => matchingEntities[relation.from] && matchingEntities[relation.to]
        );
        
        return {
          entities: matchingEntities,
          relations: matchingRelations
        };
      },
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to match against entity names, types, and observation content'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'open_nodes',
      description: 'Open specific nodes in the knowledge graph by their names',
      handler: async ({ names }) => {
        const result = {
          entities: {},
          relations: []
        };
        
        // Add requested entities
        for (const name of names) {
          if (knowledgeGraph.entities[name]) {
            result.entities[name] = knowledgeGraph.entities[name];
          }
        }
        
        // Add relations between these entities
        result.relations = knowledgeGraph.relations.filter(
          relation => names.includes(relation.from) && names.includes(relation.to)
        );
        
        return result;
      },
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'An array of entity names to retrieve'
          }
        },
        required: ['names']
      }
    }
  ]
});

// Initialize the server
server.initialize().then(() => {
  console.log('Knowledge Graph MCP Server running on stdio');
}).catch(error => {
  console.error('Failed to initialize MCP server', error);
});
