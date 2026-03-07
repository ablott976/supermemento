import { Router } from 'express';
import { set_container_config, getContainerFilterPrompt } from '../db/neo4j-client'; // Updated import path

const router = Router();

// POST endpoint to set container configuration
router.post('/container-config', async (req, res) => {
    try {
        const { containerId, filterPrompt } = req.body;

        // Basic validation
        if (!containerId || typeof containerId !== 'string') {
            return res.status(400).json({ message: 'containerId is required and must be a string.' });
        }
        // Allow filterPrompt to be null or undefined, but if provided it must be a string.
        if (filterPrompt !== undefined && typeof filterPrompt !== 'string') {
            return res.status(400).json({ message: 'filterPrompt must be a string if provided.' });
        }

        await set_container_config(containerId, filterPrompt);

        res.status(200).json({ message: 'Container configuration set successfully.' });
    } catch (error: any) {
        console.error('Error setting container config:', error);
        res.status(500).json({ message: 'Failed to set container configuration.', error: error.message });
    }
});

// GET endpoint to retrieve container configuration
router.get('/container-config', async (req, res) => {
    try {
        const { containerId } = req.query;

        // Basic validation
        if (!containerId || typeof containerId !== 'string') {
            return res.status(400).json({ message: 'containerId is required and must be a string.' });
        }

        const filterPrompt = await getContainerFilterPrompt(containerId);

        if (filterPrompt === null) {
            return res.status(404).json({ message: 'Container configuration not found.' });
        }

        res.status(200).json({ containerId, filterPrompt });
    } catch (error: any) {
        console.error('Error getting container config:', error);
        res.status(500).json({ message: 'Failed to get container configuration.', error: error.message });
    }
});

export default router;
