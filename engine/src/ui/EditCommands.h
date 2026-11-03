/*!************************************************************************
\file EditCommands.h
\brief
Declares the undoable editor commands. Each one is a QUndoCommand that
stores only the values its edit touches (before and after) and is pushed onto MainWindow's QUndoStack.
Push calls redo() straight away, so the edit is applied by the command itself
**************************************************************************/
#pragma once

#include "splat/SplatData.h"

#include <glm/glm.hpp>

#include <QUndoCommand>

#include <cstdint>
#include <string>
#include <vector>

class SplatModel;
class SplatRenderer;
struct CropBox;

//Transforms a model
//Stores its transform before and after
//The model must outlive the command
//MainWindow clears the undo stack when a model is removed from the scene for now
class MoveModelCommand : public QUndoCommand {
public:
    MoveModelCommand(SplatModel* model, const glm::mat4& before, const glm::mat4& after, QUndoCommand* parent = nullptr);

    void undo() override;
    void redo() override;

private:
    SplatModel* m_model;
    glm::mat4 m_before;
    glm::mat4 m_after;
};

//Loads/Unloads a model
//Loads from their path NOT saving the entire model
//Saves the path and their data
class LoadModelCommand : public QUndoCommand {
public:
    LoadModelCommand(SplatModel* model, const std::string& before, const std::string& after, QUndoCommand* parent = nullptr);

    void undo() override;
    void redo() override;

private:
    SplatModel* m_model;
    std::string m_before;
    std::string m_after;
};

//Renames a modle
class RenameModelCommand : public QUndoCommand {
public:
    RenameModelCommand(SplatModel* model, const std::string& before, const std::string& after, QUndoCommand* parent = nullptr);

    void undo() override;
    void redo() override;

private:
    SplatModel* m_model;
    std::string m_before;
    std::string m_after;
};

//Transforms the crop box
//Stores its transform before and after
//The box must outlive the command
class MoveCropBoxCommand : public QUndoCommand {
public:
    MoveCropBoxCommand(CropBox* box, const glm::mat4& before, const glm::mat4& after, QUndoCommand* parent = nullptr);

    void undo() override;
    void redo() override;

private:
    CropBox* m_box;
    glm::mat4 m_before;
    glm::mat4 m_after;
};

//Removes the splats a keep mask marks with 0
//Only the removed splats and their positions in the list are stored, not a second copy of the model
//The model and renderer must outlive the command
class RemoveSplatsCommand : public QUndoCommand {
public:
    //Mask is 1 = keep, 0 = remove, one entry per current splat of the model
    RemoveSplatsCommand(SplatRenderer* renderer, SplatModel* model, const std::vector<uint8_t>& keepMask, QUndoCommand* parent = nullptr);

    size_t RemovedCount() const { return m_removed.size(); }

    void undo() override;
    void redo() override;

private:
    SplatRenderer* m_renderer;
    SplatModel* m_model;
    std::vector<uint32_t> m_indices;   //Ascending positions the removed splats had before removal
    std::vector<SplatVertex> m_removed; //The removed splats, in the same order as m_indices
};

//Replaces some of a model's splats with edited versions (moved, rotated or scaled)
//Stores the affected splats before and after, so undo restores them exactly
//The model and renderer must outlive the command
class MoveSplatsCommand : public QUndoCommand {
public:
    //Applies deltaModel (a model-space transform) to the splats at the given ascending indices when redone
    MoveSplatsCommand(SplatRenderer* renderer, SplatModel* model, const std::vector<uint32_t>& indices,
                      const glm::mat4& deltaModel, QUndoCommand* parent = nullptr);

    void undo() override;
    void redo() override;

private:
    void Write(const std::vector<SplatVertex>& values);

    SplatRenderer* m_renderer;
    SplatModel* m_model;
    std::vector<uint32_t> m_indices;
    std::vector<SplatVertex> m_before;
    std::vector<SplatVertex> m_after;
};
