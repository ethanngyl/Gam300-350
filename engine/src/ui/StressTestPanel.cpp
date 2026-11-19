#include "StressTestPanel.h"

#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QStringList>
#include <QTimer>
#include <QVBoxLayout>

StressTestPanel::StressTestPanel(QWidget* parent)
	: QWidget(parent)
{
	//Widgets must be heap allocated with a parent, a stack object is destroyed when the constructor returns
	//Layout manager
	auto* layout = new QVBoxLayout(this);

	auto* testAllButton = new QPushButton("Test All", this);
	layout->addWidget(testAllButton);
	layout->addStretch(); //Keeps the button at the top instead of stretching to fill the dock

	connect(testAllButton, &QPushButton::clicked, this, [] {
		//Empty for now
	});
}

StressTestPanel::~StressTestPanel() = default;