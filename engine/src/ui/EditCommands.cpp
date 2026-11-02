/*!************************************************************************
\file EditCommands.cpp
\brief
Implements the undoable editor commands declared in EditCommands.h.
**************************************************************************/
#include "ui/EditCommands.h"

#include "splat/SplatModel.h"

MoveModelCommand::MoveModelCommand(SplatModel* model, const glm::mat4& before, const glm::mat4& after, QUndoCommand* parent) 
    : QUndoCommand(parent), m_model(model), m_before(before), m_after(after)
{
    //Shown in the Edit menu as "Undo Move <name>".
    setText(QString("Move %1").arg(QString::fromStdString(model->GetName())));
}


void MoveModelCommand::undo() {
    m_model->SetTransform(m_before);
}

void MoveModelCommand::redo() {
    m_model->SetTransform(m_after);
}

RenameModelCommand::RenameModelCommand(SplatModel* model, const std::string& before, const std::string& after, QUndoCommand* parent)
    : QUndoCommand(parent), m_model(model), m_before(before), m_after(after)
{
    //Shown in the Edit menu as "Undo Rename <old name>".
    setText(QString("Rename %1").arg(QString::fromStdString(before)));
}

void RenameModelCommand::undo() {
    m_model->SetName(m_before);
}

void RenameModelCommand::redo() {
    m_model->SetName(m_after);
}