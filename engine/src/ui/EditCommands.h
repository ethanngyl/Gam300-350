/*!************************************************************************
\file EditCommands.h
\brief
Declares the undoable editor commands. Each one is a QUndoCommand that
stores only the values its edit touches (before and after) and is pushed onto MainWindow's QUndoStack.
Push calls redo() straight away, so the edit is applied by the command itself
**************************************************************************/
#pragma once

#include <glm/glm.hpp>

#include <QUndoCommand>

#include <string>

class SplatModel;

//Transforms a model
//Stores its transform before and after
//The model must outlive the command
//MainWindow clears the undo stack when a model is removed from the scene
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
