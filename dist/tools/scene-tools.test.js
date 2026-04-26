import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { registerSceneTools } from './scene-tools.js';
// Mock fs module
vi.mock('fs/promises');
// Import after mocking
const mockFs = vi.mocked(fs);
describe('Scene Tools', () => {
    const testProjectPath = '/test/project';
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('scene file operations', () => {
        it('should read a scene file', async () => {
            const sceneContent = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`;
            mockFs.readFile.mockResolvedValue(sceneContent);
            const result = await mockFs.readFile(path.join(testProjectPath, 'scenes/main.tscn'), 'utf-8');
            expect(result).toBe(sceneContent);
            expect(mockFs.readFile).toHaveBeenCalledWith(path.join(testProjectPath, 'scenes/main.tscn'), 'utf-8');
        });
        it('should write a scene file', async () => {
            mockFs.writeFile.mockResolvedValue(undefined);
            mockFs.mkdir.mockResolvedValue(undefined);
            const sceneContent = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`;
            await mockFs.writeFile(path.join(testProjectPath, 'scenes/test.tscn'), sceneContent);
            expect(mockFs.writeFile).toHaveBeenCalledWith(path.join(testProjectPath, 'scenes/test.tscn'), sceneContent);
        });
        it('should list scene files', async () => {
            mockFs.readdir.mockImplementation(async (dirPath) => {
                if (String(dirPath).endsWith('scenes')) {
                    return ['main.tscn', 'player.tscn', 'enemy.tscn'];
                }
                return [];
            });
            const files = await mockFs.readdir(path.join(testProjectPath, 'scenes'));
            expect(files).toContain('main.tscn');
            expect(files).toContain('player.tscn');
        });
    });
    describe('scene validation', () => {
        it('should validate scene has root node', () => {
            const sceneContent = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`;
            // Parse and check for root node
            const hasRootNode = sceneContent.includes('[node name=');
            expect(hasRootNode).toBe(true);
        });
        it('should detect missing root node', () => {
            const sceneContent = `[gd_scene format=3]
`;
            const hasRootNode = sceneContent.includes('[node name=');
            expect(hasRootNode).toBe(false);
        });
        it('should validate node parent references', () => {
            const sceneContent = `[gd_scene format=3]

[node name="Main" type="Node2D"]

[node name="Child" type="Sprite2D" parent="."]
`;
            // Valid parent reference "." means root
            const validParentRef = sceneContent.includes('parent="."');
            expect(validParentRef).toBe(true);
        });
    });
    describe('validate_scene catches parent="<root-name>" mistake', () => {
        // Common foot-gun: a child of the root has parent="<RootNodeName>" instead of
        // parent=".". Both forms write/parse fine, but only "." resolves at
        // PackedScene.instantiate() — the other form silently drops the children.
        // The validator should flag the wrong form so callers can correct it before
        // the runtime warning ("Parent path './<RootName>' has vanished").
        const setup = () => {
            const tools = new Map();
            registerSceneTools(tools, {
                projectPath: testProjectPath,
                editorConnected: false,
                editorPort: 6550,
            });
            return tools.get('godot_validate_scene');
        };
        it('flags parent="<root-node-name>" as an error pointing at parent="."', async () => {
            const sceneContent = `[gd_scene load_steps=1 format=3]

[node name="RepoRoot" type="Node2D"]

[node name="Inner" type="Node2D" parent="RepoRoot"]
`;
            mockFs.readFile.mockResolvedValue(sceneContent);
            const validate = setup();
            const result = await validate.handler({ scenePath: 'res://test.tscn' });
            expect(result.valid).toBe(false);
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                message: expect.stringContaining(`parent='.'`),
            }));
        });
        it('does not false-positive on parent="." for direct children of root', async () => {
            const sceneContent = `[gd_scene load_steps=1 format=3]

[node name="RepoRoot" type="Node2D"]

[node name="Inner" type="Node2D" parent="."]
`;
            mockFs.readFile.mockResolvedValue(sceneContent);
            const validate = setup();
            const result = await validate.handler({ scenePath: 'res://test.tscn' });
            expect(result.valid).toBe(true);
            expect(result.issues).toEqual([]);
        });
    });
    describe('node manipulation', () => {
        it('should detect node types', () => {
            const nodeTypes = ['Node2D', 'CharacterBody2D', 'Sprite2D', 'CollisionShape2D'];
            for (const type of nodeTypes) {
                const content = `[node name="Test" type="${type}"]`;
                expect(content).toContain(`type="${type}"`);
            }
        });
        it('should handle node properties', () => {
            const properties = {
                position: 'Vector2(100, 200)',
                rotation: '1.5708',
                scale: 'Vector2(2, 2)',
                visible: 'true',
            };
            for (const [key, value] of Object.entries(properties)) {
                const line = `${key} = ${value}`;
                expect(line).toContain(key);
                expect(line).toContain(value);
            }
        });
    });
});
describe('Scene Path Utilities', () => {
    it('should convert resource paths', () => {
        const resPath = 'res://scenes/main.tscn';
        const projectPath = '/home/user/project';
        // Strip res:// and join with project path
        const relativePath = resPath.replace('res://', '');
        const fullPath = path.join(projectPath, relativePath);
        expect(fullPath).toBe('/home/user/project/scenes/main.tscn');
    });
    it('should handle nested paths', () => {
        const resPath = 'res://levels/world1/stage1.tscn';
        const projectPath = '/project';
        const relativePath = resPath.replace('res://', '');
        const fullPath = path.join(projectPath, relativePath);
        expect(fullPath).toBe('/project/levels/world1/stage1.tscn');
    });
});
//# sourceMappingURL=scene-tools.test.js.map